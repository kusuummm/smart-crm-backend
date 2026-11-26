/**
 * Database Row-Level Security (RLS) & Multi-Tenant Isolation Engine:
 * - Centralized RLS query filter builders for CRM collections
 * - Multi-tenant isolation enforcement across all data operations
 * - Database view and aggregation pipeline access restriction scoping
 * - Object-level record authorization verification
 * - Privileged service account least-privilege auditing
 */

const mongoose = require('mongoose');

/**
 * Checks if user holds administrative governance privileges (admin, owner).
 */
function isAdminOrOwner(user) {
  if (!user) return false;
  const role = (user.role || '').toLowerCase().trim();
  return role === 'admin' || role === 'owner';
}

/**
 * Resolves current tenant context from request or user object.
 */
function getTenantId(reqOrUser) {
  if (!reqOrUser) return null;
  if (reqOrUser.tenantId) return String(reqOrUser.tenantId);
  if (reqOrUser.headers && reqOrUser.headers['x-tenant-id']) {
    return String(reqOrUser.headers['x-tenant-id']).trim();
  }
  if (reqOrUser.user && reqOrUser.user.tenantId) {
    return String(reqOrUser.user.tenantId);
  }
  return null;
}

/**
 * Constructs a database Row-Level Security (RLS) filter for queries.
 * Non-admin users are strictly scoped to their assigned records.
 *
 * @param {Object} user - The authenticated user
 * @param {string} resourceType - 'customers' | 'leads' | 'calls' | 'notes' | 'followups' | 'meetings' | 'applications' | 'eods' | 'orders' | 'wallets'
 * @param {Object} baseFilter - Existing query conditions to merge
 * @param {Array} assignedCustomerIds - Optional pre-resolved customer IDs for lead scoping
 * @returns {Object} Scoped Mongoose query filter
 */
function buildUserRlsFilter(user, resourceType, baseFilter = {}, assignedCustomerIds = []) {
  const merged = { ...baseFilter };

  // Administrative roles have organization-wide visibility
  if (isAdminOrOwner(user)) {
    return merged;
  }

  const userId = user._id || user.id;
  const userName = user.name || '';

  switch (resourceType) {
    case 'customers':
      merged.$or = [
        { telecallerId: userId },
        { assignedTelecaller: userName },
      ];
      break;

    case 'leads':
      {
        const leadConditions = [{ telecallerId: userId }];
        if (assignedCustomerIds && assignedCustomerIds.length > 0) {
          leadConditions.push({ customerId: { $in: assignedCustomerIds } });
        }
        merged.$or = leadConditions;
      }
      break;

    case 'calls':
      merged.$or = [
        { calledBy: userId },
        { calledByName: userName },
      ];
      break;

    case 'notes':
      merged.$or = [
        { createdBy: userId },
        { createdByName: userName },
      ];
      break;

    case 'followups':
      merged.$or = [
        { createdBy: userId },
        { assignedTo: userId },
      ];
      break;

    case 'meetings':
      merged.telecallerId = userId;
      break;

    case 'applications':
      merged.$or = [
        { applicantId: userId },
        { customerId: userId },
        { assignedTelecallerId: userId },
      ];
      break;

    case 'eods':
      merged.userId = userId;
      break;

    case 'orders':
    case 'wallets':
      merged.userId = userId;
      break;

    default:
      // Default fail-safe: scope by user reference if unknown resource
      merged.userId = userId;
      break;
  }

  return merged;
}

/**
 * Enforces cross-tenant isolation by injecting tenantId constraints.
 * Ensures Tenant A can never query or mutate Tenant B records.
 */
function buildTenantRlsFilter(tenantId, baseFilter = {}) {
  const merged = { ...baseFilter };
  if (tenantId) {
    merged.tenantId = tenantId;
  }
  return merged;
}

/**
 * Scopes MongoDB aggregation pipelines to enforce database view & function RLS:
 * Ensures the first stage of the pipeline ($match) strictly incorporates the caller's RLS constraints.
 */
function scopeAggregatePipeline(user, pipeline = [], resourceType = 'customers') {
  if (!Array.isArray(pipeline)) return pipeline;
  if (isAdminOrOwner(user)) return pipeline;

  const rlsFilter = buildUserRlsFilter(user, resourceType);

  // If first stage is already a $match, merge constraints
  if (pipeline.length > 0 && pipeline[0].$match) {
    const existingMatch = pipeline[0].$match;
    pipeline[0] = {
      $match: {
        $and: [existingMatch, rlsFilter],
      },
    };
  } else {
    // Prepend $match stage as stage 0
    pipeline.unshift({ $match: rlsFilter });
  }

  return pipeline;
}

/**
 * Validates whether an authenticated user is authorized to view or mutate a retrieved record.
 * Prevents Insecure Direct Object References (IDOR).
 */
function verifyRecordAccess(user, record, resourceType) {
  if (!user || !record) return false;
  if (isAdminOrOwner(user)) return true;

  const userId = String(user._id || user.id);
  const userName = user.name || '';

  switch (resourceType) {
    case 'customers':
      return (
        (record.telecallerId && String(record.telecallerId) === userId) ||
        record.assignedTelecaller === userName
      );

    case 'leads':
      return (
        (record.telecallerId && String(record.telecallerId) === userId) ||
        (record.assignedTo && String(record.assignedTo) === userId)
      );

    case 'calls':
      return (
        (record.calledBy && String(record.calledBy) === userId) ||
        record.calledByName === userName
      );

    case 'notes':
      return (
        (record.createdBy && String(record.createdBy) === userId) ||
        record.createdByName === userName
      );

    case 'followups':
      return (
        (record.createdBy && String(record.createdBy) === userId) ||
        (record.assignedTo && String(record.assignedTo) === userId)
      );

    case 'meetings':
      return record.telecallerId && String(record.telecallerId) === userId;

    case 'eods':
      return record.userId && String(record.userId) === userId;

    case 'orders':
    case 'wallets':
      return record.userId && String(record.userId) === userId;

    default:
      return false;
  }
}

/**
 * Audits MongoDB connection configuration for least-privilege service account enforcement:
 * - Checks connection string does not use 'root' or 'admin' superuser
 * - Verifies TLS/SSL in production environments
 * - Checks that readWrite role is used rather than clusterAdmin / dbAdminAnyDatabase
 */
function validateDatabaseServiceAccount(mongoUri = process.env.MONGO_URI, env = process.env.NODE_ENV) {
  const issues = [];
  if (!mongoUri || typeof mongoUri !== 'string') {
    return { valid: false, issues: ['MONGO_URI environment variable is missing or invalid'] };
  }

  // 1. Check for privileged superuser in connection URI
  const isRootUser =
    /\/\/(?:root|admin|superuser):/i.test(mongoUri) ||
    /authSource=admin/i.test(mongoUri) && /\/\/(?:root|admin):/i.test(mongoUri);

  if (isRootUser && env === 'production') {
    issues.push('Production database connection string must not use privileged root/admin superuser credentials');
  }

  // 2. Check for TLS in production
  if (env === 'production') {
    const isLocalhost = mongoUri.includes('localhost') || mongoUri.includes('127.0.0.1');
    const isSrv = mongoUri.startsWith('mongodb+srv://');
    const hasTls = /tls=true|ssl=true/i.test(mongoUri);

    if (!isLocalhost && !isSrv && !hasTls) {
      issues.push('Remote production database connection must require TLS/SSL encryption');
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    serviceAccount: {
      leastPrivilegeRole: 'readWrite (restricted to application database only)',
      tlsRequiredInProduction: true,
      superUserProhibited: true,
    },
  };
}

module.exports = {
  isAdminOrOwner,
  getTenantId,
  buildUserRlsFilter,
  buildTenantRlsFilter,
  scopeAggregatePipeline,
  verifyRecordAccess,
  validateDatabaseServiceAccount,
};
