/**
 * Resource Protection & Denial of Service (DoS) Defense Middleware:
 * - Request Size Restrictions & Early Content-Length Validation (413 Payload Too Large)
 * - Request Processing Timeouts & Hanging Request Mitigation (408 / 504 Timeout)
 * - Concurrency Limits & Resource Throttling (503 Service Unavailable)
 * - Node.js HTTP Server Socket, Header & Keep-Alive Timeout Hardening
 * - HTTP/2 Infrastructure Security & CVE Status Verification
 */

// Default size thresholds
const DEFAULT_JSON_SIZE_LIMIT = 1024 * 1024; // 1 MB
const DEFAULT_MULTIPART_SIZE_LIMIT = 15 * 1024 * 1024; // 15 MB

/**
 * Early request size validator that inspects `Content-Length` header before
 * the body is buffered into memory, preventing memory exhaustion attacks.
 */
function requestSizeLimiter(options = {}) {
  const jsonLimit = options.jsonLimit || DEFAULT_JSON_SIZE_LIMIT;
  const multipartLimit = options.multipartLimit || DEFAULT_MULTIPART_SIZE_LIMIT;

  return (req, res, next) => {
    const contentLength = req.headers['content-length'];
    if (!contentLength) {
      return next();
    }

    const length = parseInt(contentLength, 10);
    if (isNaN(length) || length < 0) {
      res.setHeader('Connection', 'close');
      req.resume();
      return res.status(400).json({
        success: false,
        message: 'Invalid Content-Length header',
      });
    }

    const contentType = (req.headers['content-type'] || '').toLowerCase();
    const isMultipart = contentType.includes('multipart/form-data');
    const threshold = isMultipart ? multipartLimit : jsonLimit;

    if (length > threshold) {
      const maxMb = Math.round((threshold / (1024 * 1024)) * 10) / 10;
      res.setHeader('Connection', 'close');
      req.resume();
      return res.status(413).json({
        success: false,
        message: `Payload Too Large: Request body size (${Math.round(length / 1024)} KB) exceeds the maximum allowed limit of ${maxMb} MB.`,
      });
    }

    next();
  };
}

/**
 * Request execution timeout middleware.
 * If processing exceeds the timeout limit, cleanly aborts and responds to client.
 */
function requestTimeoutMiddleware(timeoutSeconds = 30) {
  const timeoutMs = timeoutSeconds * 1000;

  return (req, res, next) => {
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      if (!res.headersSent) {
        res.setHeader('Connection', 'close');
        res.status(504).json({
          success: false,
          message: `Request Timeout: Processing exceeded the maximum time limit of ${timeoutSeconds} seconds.`,
        });
      }
    }, timeoutMs);

    // Cancel timer when response concludes
    const cleanup = () => {
      clearTimeout(timer);
    };

    res.on('finish', cleanup);
    res.on('close', cleanup);

    next();
  };
}

/**
 * Concurrency limiter that caps the number of simultaneous active executions
 * on resource-intensive endpoints (such as AI LLM generation or large exports).
 */
function concurrencyLimiter({ maxConcurrent = 10, name = 'operation' } = {}) {
  let activeRequests = 0;

  return (req, res, next) => {
    if (activeRequests >= maxConcurrent) {
      res.setHeader('Retry-After', '5');
      return res.status(503).json({
        success: false,
        message: `Service Busy: Server reached maximum concurrent ${name} capacity (${maxConcurrent}). Please retry shortly.`,
        retryAfter: 5,
      });
    }

    activeRequests++;

    let released = false;
    const release = () => {
      if (!released) {
        released = true;
        activeRequests = Math.max(0, activeRequests - 1);
      }
    };

    res.on('finish', release);
    res.on('close', release);

    next();
  };
}

/**
 * Applies defensive socket and header timeouts to the Node.js HTTP server:
 * - headersTimeout: Mitigates Slowloris attacks (slow delivery of HTTP request headers)
 * - requestTimeout: Caps maximum duration to receive entire incoming request
 * - keepAliveTimeout: Prevents race conditions with upstream reverse proxies (Render, Cloudflare, ALB)
 * - setTimeout: Caps idle socket lifetime
 */
function applyServerTimeouts(server, options = {}) {
  if (!server) return;

  const requestTimeout = options.requestTimeout || 30000; // 30 seconds
  const headersTimeout = options.headersTimeout || 15000; // 15 seconds (must be < requestTimeout)
  const keepAliveTimeout = options.keepAliveTimeout || 65000; // 65 seconds (must be > proxy keepalive)
  const socketTimeout = options.socketTimeout || 35000; // 35 seconds

  // Apply to Node.js server instance
  server.requestTimeout = requestTimeout;
  server.headersTimeout = headersTimeout;
  server.keepAliveTimeout = keepAliveTimeout;
  if (typeof server.setTimeout === 'function') {
    server.setTimeout(socketTimeout);
  }

  return {
    requestTimeout,
    headersTimeout,
    keepAliveTimeout,
    socketTimeout,
  };
}

/**
 * Generates an audit report on HTTP/2 infrastructure and CVE patch posture:
 * - CVE-2023-44487: HTTP/2 Rapid Reset vulnerability (patched in Node v18.18.2+, v20.8.1+, v21.1.0+)
 * - CVE-2024-27983: HTTP/2 CONTINUATION flood vulnerability (patched in Node v18.20.1+, v20.12.1+, v21.7.2+)
 */
function getHttp2SecurityReport() {
  const version = process.version; // e.g. "v24.14.1"
  const cleanVersion = version.replace(/^v/, '');
  const [major, minor, patch] = cleanVersion.split('.').map((n) => parseInt(n, 10));

  let isRapidResetPatched = false;
  let isContinuationFloodPatched = false;

  if (major >= 22) {
    isRapidResetPatched = true;
    isContinuationFloodPatched = true;
  } else if (major === 20) {
    if (minor > 12 || (minor === 12 && patch >= 1)) {
      isRapidResetPatched = true;
      isContinuationFloodPatched = true;
    } else if (minor > 8 || (minor === 8 && patch >= 1)) {
      isRapidResetPatched = true;
    }
  } else if (major === 18) {
    if (minor > 20 || (minor === 20 && patch >= 1)) {
      isRapidResetPatched = true;
      isContinuationFloodPatched = true;
    } else if (minor > 18 || (minor === 18 && patch >= 2)) {
      isRapidResetPatched = true;
    }
  }

  return {
    nodeVersion: version,
    http2Supported: true,
    cveStatus: {
      'CVE-2023-44487': {
        vulnerability: 'HTTP/2 Rapid Reset stream cancellation flood DoS',
        isPatched: isRapidResetPatched,
        status: isRapidResetPatched ? 'PATCHED' : 'VULNERABLE',
      },
      'CVE-2024-27983': {
        vulnerability: 'HTTP/2 CONTINUATION frame header flood unbounded memory exhaustion',
        isPatched: isContinuationFloodPatched,
        status: isContinuationFloodPatched ? 'PATCHED' : 'VULNERABLE',
      },
    },
    reverseProxyArchitecture: {
      tlsTermination: 'Edge Reverse Proxy (Cloudflare / Render ALB)',
      http2Handling: 'HTTP/2 terminated at Edge; proxies to Node backend via persistent HTTP/1.1 keep-alive',
      recommendation: 'Keep upstream reverse proxy HTTP/2 termination active to absorb edge stream resets',
    },
  };
}

module.exports = {
  requestSizeLimiter,
  requestTimeoutMiddleware,
  concurrencyLimiter,
  applyServerTimeouts,
  getHttp2SecurityReport,
  DEFAULT_JSON_SIZE_LIMIT,
  DEFAULT_MULTIPART_SIZE_LIMIT,
};
