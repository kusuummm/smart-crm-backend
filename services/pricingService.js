/**
 * Trusted Server-Side Pricing, Tax & Discount Calculation Service
 * 
 * Enforces that product prices, taxes (GST 18%), authorized discounts, and
 * final totals are ALWAYS computed from trusted server-side models.
 * 
 * Rejects unauthorized client-side pricing overrides, negative numbers,
 * invalid coupon codes, and tampered totals.
 */

// Authoritative Product & Service Pricing Catalog (in INR)
const PRODUCT_CATALOG = {
  // Subscription Plans
  pro_annual: {
    id: 'pro_annual',
    name: 'Unlimited All-in-One Pro Annual Plan',
    basePrice: 14999,
    currency: 'INR',
    taxRate: 0.18,
    category: 'plan',
    billingCycle: 'yearly',
  },
  biz_phone_quarterly: {
    id: 'biz_phone_quarterly',
    name: 'Biz Phone 3-Month Plan',
    basePrice: 3499,
    currency: 'INR',
    taxRate: 0.18,
    category: 'plan',
    billingCycle: 'quarterly',
  },
  biz_phone_annual: {
    id: 'biz_phone_annual',
    name: 'Biz Phone Annual Plan',
    basePrice: 11999,
    currency: 'INR',
    taxRate: 0.18,
    category: 'plan',
    billingCycle: 'yearly',
  },
  lead_addon_pack: {
    id: 'lead_addon_pack',
    name: 'Users Lead Add-on Quota (x2)',
    basePrice: 1000,
    currency: 'INR',
    taxRate: 0.18,
    category: 'addon',
    billingCycle: 'monthly',
  },

  // Virtual Telephony Numbers
  virtual_delhi: {
    id: 'virtual_delhi',
    name: 'Delhi Landline Virtual Number (+91 11)',
    basePrice: 499,
    currency: 'INR',
    taxRate: 0.18,
    category: 'addon',
    billingCycle: 'monthly',
  },
  virtual_mumbai: {
    id: 'virtual_mumbai',
    name: 'Mumbai Landline Virtual Number (+91 22)',
    basePrice: 499,
    currency: 'INR',
    taxRate: 0.18,
    category: 'addon',
    billingCycle: 'monthly',
  },
  virtual_vip: {
    id: 'virtual_vip',
    name: 'VIP Golden Virtual Number',
    basePrice: 999,
    currency: 'INR',
    taxRate: 0.18,
    category: 'addon',
    billingCycle: 'monthly',
  },
  tollfree_1800: {
    id: 'tollfree_1800',
    name: 'Toll-Free 1800 Virtual Number',
    basePrice: 1499,
    currency: 'INR',
    taxRate: 0.18,
    category: 'addon',
    billingCycle: 'monthly',
  },

  // PeYug Cooperative Society Applications & Services
  app_membership: {
    id: 'app_membership',
    name: 'PeYug Society Membership Fee',
    basePrice: 500,
    currency: 'INR',
    taxRate: 0.18,
    category: 'application_fee',
  },
  app_cooperative_loan: {
    id: 'app_cooperative_loan',
    name: 'Cooperative Loan Processing Fee',
    basePrice: 1000,
    currency: 'INR',
    taxRate: 0.18,
    category: 'application_fee',
  },
  app_fixed_deposit: {
    id: 'app_fixed_deposit',
    name: 'Fixed Deposit Account Opening Fee',
    basePrice: 200,
    currency: 'INR',
    taxRate: 0.18,
    category: 'application_fee',
  },
  app_recurring_deposit: {
    id: 'app_recurring_deposit',
    name: 'Recurring Deposit Account Opening Fee',
    basePrice: 200,
    currency: 'INR',
    taxRate: 0.18,
    category: 'application_fee',
  },
  app_society_registration: {
    id: 'app_society_registration',
    name: 'Society Registration Fee',
    basePrice: 2500,
    currency: 'INR',
    taxRate: 0.18,
    category: 'application_fee',
  },
  app_certificate_issue: {
    id: 'app_certificate_issue',
    name: 'Final Certificate Issuance Fee',
    basePrice: 350,
    currency: 'INR',
    taxRate: 0.18,
    category: 'application_fee',
  },
  app_general_service: {
    id: 'app_general_service',
    name: 'General Service Application Fee',
    basePrice: 150,
    currency: 'INR',
    taxRate: 0.18,
    category: 'application_fee',
  },
};

// Application type mapping helper
const APPLICATION_FEE_MAP = {
  membership: 500,
  cooperative_loan: 1000,
  fixed_deposit: 200,
  recurring_deposit: 200,
  society_registration: 2500,
  certificate_issue: 350,
  general_service: 150,
};

// Authorized Promo / Discount Codes
const PROMO_CODES = {
  WELCOME10: {
    code: 'WELCOME10',
    type: 'percentage',
    value: 10, // 10%
    maxDiscount: 1500,
    minOrderAmount: 1000,
    description: '10% off for new customers up to ₹1,500',
  },
  ANNUAL20: {
    code: 'ANNUAL20',
    type: 'percentage',
    value: 20, // 20%
    maxDiscount: 3000,
    minOrderAmount: 10000,
    description: '20% off on annual plans up to ₹3,000',
  },
  FESTIVE500: {
    code: 'FESTIVE500',
    type: 'flat',
    value: 500, // ₹500 flat
    maxDiscount: 500,
    minOrderAmount: 2000,
    description: 'Flat ₹500 discount on orders above ₹2,000',
  },
};

/**
 * Returns the trusted application fee for a given application type.
 */
function getApplicationFee(applicationType) {
  const normalized = (applicationType || 'membership').toLowerCase().trim();
  if (normalized in APPLICATION_FEE_MAP) {
    return APPLICATION_FEE_MAP[normalized];
  }
  return 500; // Default membership fee
}

/**
 * Calculates discount amount based on trusted server rules.
 */
function calculateDiscount(subtotal, promoCode) {
  if (!promoCode) return { discount: 0, promoCodeApplied: null };

  const cleanCode = String(promoCode).trim().toUpperCase();
  const rule = PROMO_CODES[cleanCode];

  if (!rule) {
    const error = new Error(`Invalid or expired promo code: "${promoCode}"`);
    error.statusCode = 400;
    throw error;
  }

  if (subtotal < rule.minOrderAmount) {
    const error = new Error(
      `Promo code "${cleanCode}" requires a minimum subtotal of ₹${rule.minOrderAmount}. Current subtotal is ₹${subtotal}.`
    );
    error.statusCode = 400;
    throw error;
  }

  let discount = 0;
  if (rule.type === 'percentage') {
    discount = (subtotal * rule.value) / 100;
  } else if (rule.type === 'flat') {
    discount = rule.value;
  }

  // Cap at maximum discount
  discount = Math.min(discount, rule.maxDiscount);
  discount = Math.min(discount, subtotal); // Cannot discount below 0
  discount = Math.round(discount * 100) / 100;

  return { discount, promoCodeApplied: cleanCode };
}

/**
 * Computes authoritative checkout pricing from trusted server catalog.
 *
 * @param {Object} options
 * @param {Array} options.items - Array of { productId, quantity }
 * @param {string} [options.promoCode] - Optional promotional coupon
 * @param {number} [options.walletTopupAmount] - Optional dynamic wallet recharge
 * @param {Object} [options.claimedPricing] - Optional client-submitted values to verify against tampering
 * @returns {Object} Complete trusted price breakdown
 */
function calculateCheckoutPricing({
  items = [],
  promoCode = '',
  walletTopupAmount = null,
  claimedPricing = null,
} = {}) {
  // Case 1: Pure Wallet Balance Top-Up
  if (walletTopupAmount !== null && walletTopupAmount !== undefined) {
    const amount = parseFloat(walletTopupAmount);

    if (isNaN(amount) || !Number.isFinite(amount)) {
      const error = new Error('Invalid wallet top-up amount');
      error.statusCode = 400;
      throw error;
    }

    if (amount <= 0) {
      const error = new Error('Wallet top-up amount must be greater than zero');
      error.statusCode = 400;
      throw error;
    }

    if (amount < 10) {
      const error = new Error('Minimum wallet recharge is ₹10');
      error.statusCode = 400;
      throw error;
    }

    if (amount > 100000) {
      const error = new Error('Maximum single wallet recharge is ₹100,000');
      error.statusCode = 400;
      throw error;
    }

    const roundedAmount = Math.round(amount * 100) / 100;

    // Reject price tampering if client claimed a different amount
    if (claimedPricing && claimedPricing.total !== undefined) {
      const claimedTotal = parseFloat(claimedPricing.total);
      if (Math.abs(claimedTotal - roundedAmount) > 0.01) {
        const error = new Error(
          `Price tampering detected: Client submitted total ₹${claimedTotal} does not match verified amount ₹${roundedAmount}`
        );
        error.statusCode = 400;
        throw error;
      }
    }

    return {
      type: 'wallet_recharge',
      items: [
        {
          productId: 'wallet_topup',
          name: 'Smart CRM Wallet Balance Top-Up',
          basePrice: roundedAmount,
          quantity: 1,
          subtotal: roundedAmount,
        },
      ],
      pricing: {
        subtotal: roundedAmount,
        discount: 0,
        promoCode: null,
        taxableAmount: roundedAmount,
        taxRate: 0, // Principal deposit has no GST; GST applies when spending on specific plans
        taxAmount: 0,
        total: roundedAmount,
        currency: 'INR',
      },
    };
  }

  // Case 2: Products, Plans, Add-ons, or Applications
  if (!Array.isArray(items) || items.length === 0) {
    const error = new Error('At least one valid item is required for checkout calculation');
    error.statusCode = 400;
    throw error;
  }

  const calculatedItems = [];
  let subtotal = 0;

  for (const rawItem of items) {
    const productId = String(rawItem.productId || rawItem.id || '').trim();
    if (!productId || !(productId in PRODUCT_CATALOG)) {
      const error = new Error(
        `Unknown or invalid product identifier: "${productId}". Prices can only be computed for catalog items.`
      );
      error.statusCode = 400;
      throw error;
    }

    const catalogProduct = PRODUCT_CATALOG[productId];
    const rawQty = parseInt(rawItem.quantity, 10);
    const quantity = isNaN(rawQty) || rawQty <= 0 ? 1 : rawQty;

    if (quantity > 100) {
      const error = new Error(`Quantity for ${catalogProduct.name} exceeds maximum permitted limit (100)`);
      error.statusCode = 400;
      throw error;
    }

    // ALWAYS use trusted server basePrice (client cannot pass custom price)
    const lineSubtotal = Math.round(catalogProduct.basePrice * quantity * 100) / 100;
    subtotal += lineSubtotal;

    calculatedItems.push({
      productId: catalogProduct.id,
      name: catalogProduct.name,
      basePrice: catalogProduct.basePrice,
      quantity,
      subtotal: lineSubtotal,
    });
  }

  subtotal = Math.round(subtotal * 100) / 100;

  // Compute discount using server logic
  const { discount, promoCodeApplied } = calculateDiscount(subtotal, promoCode);
  const taxableAmount = Math.round(Math.max(0, subtotal - discount) * 100) / 100;

  // Standard India GST 18% (9% CGST + 9% SGST)
  const taxRate = 0.18;
  const taxAmount = Math.round(taxableAmount * taxRate * 100) / 100;
  const finalTotal = Math.round((taxableAmount + taxAmount) * 100) / 100;

  // Price Tampering Verification:
  // If the client explicitly sent its own calculation, compare it strictly to server calculation
  if (claimedPricing) {
    const clientSubtotal = claimedPricing.subtotal !== undefined ? parseFloat(claimedPricing.subtotal) : null;
    const clientDiscount = claimedPricing.discount !== undefined ? parseFloat(claimedPricing.discount) : null;
    const clientTotal = claimedPricing.total !== undefined ? parseFloat(claimedPricing.total) : null;

    if (clientSubtotal !== null && Math.abs(clientSubtotal - subtotal) > 0.05) {
      const error = new Error(
        `Price tampering detected: Client subtotal ₹${clientSubtotal} deviates from server catalog subtotal ₹${subtotal}`
      );
      error.statusCode = 400;
      throw error;
    }

    if (clientDiscount !== null && Math.abs(clientDiscount - discount) > 0.05) {
      const error = new Error(
        `Price tampering detected: Unauthorized discount claimed ₹${clientDiscount}. Authorized discount is ₹${discount}`
      );
      error.statusCode = 400;
      throw error;
    }

    if (clientTotal !== null && Math.abs(clientTotal - finalTotal) > 0.05) {
      const error = new Error(
        `Price tampering detected: Client submitted final total ₹${clientTotal} does not match verified server total ₹${finalTotal}`
      );
      error.statusCode = 400;
      throw error;
    }
  }

  return {
    type: calculatedItems[0]?.category === 'plan' ? 'plan_subscription' : 'addon_purchase',
    items: calculatedItems,
    pricing: {
      subtotal,
      discount,
      promoCode: promoCodeApplied,
      taxableAmount,
      taxRate,
      taxAmount,
      total: finalTotal,
      currency: 'INR',
    },
  };
}

module.exports = {
  PRODUCT_CATALOG,
  PROMO_CODES,
  APPLICATION_FEE_MAP,
  getApplicationFee,
  calculateDiscount,
  calculateCheckoutPricing,
};
