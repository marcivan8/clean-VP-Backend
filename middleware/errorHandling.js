// middleware/errorHandler.js - Comprehensive error handling

const { translateError } = require('../utils/translations');

// Error types mapping
const ERROR_TYPES = {
  // Authentication errors
  'INVALID_TOKEN': { status: 401, code: 'AUTH_INVALID_TOKEN' },
  'TOKEN_EXPIRED': { status: 401, code: 'AUTH_TOKEN_EXPIRED' },
  'NO_AUTH_HEADER': { status: 401, code: 'AUTH_NO_HEADER' },
  'USER_NOT_FOUND': { status: 404, code: 'AUTH_USER_NOT_FOUND' },
  'PROFILE_NOT_FOUND': { status: 404, code: 'AUTH_PROFILE_NOT_FOUND' },
  
  // Usage limit errors
  'MONTHLY_LIMIT_REACHED': { status: 403, code: 'USAGE_MONTHLY_LIMIT' },
  'USAGE_CHECK_FAILED': { status: 500, code: 'USAGE_CHECK_ERROR' },
  
  // File upload errors
  'FILE_TOO_LARGE': { status: 413, code: 'UPLOAD_FILE_TOO_LARGE' },
  'INVALID_FILE_TYPE': { status: 400, code: 'UPLOAD_INVALID_TYPE' },
  'UPLOAD_FAILED': { status: 500, code: 'UPLOAD_FAILED' },
  
  // Analysis errors
  'ANALYSIS_FAILED': { status: 500, code: 'ANALYSIS_FAILED' },
  'TRANSCRIPTION_FAILED': { status: 500, code: 'ANALYSIS_TRANSCRIPTION_FAILED' },
  
  // Database errors
  'DATABASE_ERROR': { status: 500, code: 'DB_ERROR' },
  'PROFILE_EXISTS': { status: 409, code: 'DB_PROFILE_EXISTS' },
  
  // Storage errors
  'STORAGE_ERROR': { status: 500, code: 'STORAGE_ERROR' },
  'FILE_NOT_FOUND': { status: 404, code: 'STORAGE_FILE_NOT_FOUND' },
  
  // Validation errors
  'MISSING_REQUIRED_FIELDS': { status: 400, code: 'VALIDATION_MISSING_FIELDS' },
  'INVALID_DATA_FORMAT': { status: 400, code: 'VALIDATION_INVALID_FORMAT' }
};

// Multer error handler
const handleMulterError = (error, language = 'en') => {
  if (error.code === 'LIMIT_FILE_SIZE') {
    return {
      status: 413,
      error: translateError('file_too_large', language),
      code: 'UPLOAD_FILE_TOO_LARGE'
    };
  }
  
  if (error.code === 'LIMIT_UNEXPECTED_FILE') {
    return {
      status: 400,
      error: translateError('invalid_file_type', language),
      code: 'UPLOAD_INVALID_TYPE'
    };
  }
  
  return {
    status: 400,
    error: error.message || 'Upload error',
    code: 'UPLOAD_ERROR'
  };
};

// Supabase error handler
const handleSupabaseError = (error, language = 'en') => {
  // PostgreSQL error codes
  switch (error.code) {
    case '23505': // Unique constraint violation
      return {
        status: 409,
        error: 'Resource already exists',
        code: 'DB_UNIQUE_VIOLATION'
      };
    
    case '23502': // Not null constraint violation
      return {
        status: 400,
        error: translateError('missing_required_fields', language),
        code: 'DB_NOT_NULL_VIOLATION'
      };
    
    case '23514': // Check constraint violation
      return {
        status: 400,
        error: 'Invalid data format',
        code: 'DB_CHECK_VIOLATION'
      };
    
    case 'PGRST116': // PostgREST: no rows found
      return {
        status: 404,
        error: 'Resource not found',
        code: 'DB_NOT_FOUND'
      };
    
    default:
      return {
        status: 500,
        error: 'Database error',
        code: 'DB_ERROR',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      };
  }
};

// OpenAI error handler
const handleOpenAIError = (error, language = 'en') => {
  if (error.response?.status === 401) {
    return {
      status: 500,
      error: 'AI service authentication failed',
      code: 'AI_AUTH_ERROR'
    };
  }
  
  if (error.response?.status === 429) {
    return {
      status: 429,
      error: 'AI service rate limit reached. Please try again later.',
      code: 'AI_RATE_LIMIT'
    };
  }
  
  if (error.response?.status >= 500) {
    return {
      status: 503,
      error: 'AI service temporarily unavailable',
      code: 'AI_SERVICE_ERROR'
    };
  }
  
  return {
    status: 500,
    error: translateError('transcription_failed', language),
    code: 'AI_ERROR'
  };
};

// Main error handler middleware
const errorHandler = (error, req, res, next) => {
  const language = req.body?.language || req.query?.language || 'en';
  let response = {
    error: 'Internal server error',
    code: 'INTERNAL_ERROR',
    timestamp: new Date().toISOString()
  };
  let status = 500;
  
  console.error('Error Handler - Original error:', {
    name: error.name,
    message: error.message,
    code: error.code,
    stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
  });

  // Handle different error types
  if (error.name === 'MulterError') {
    const multerResponse = handleMulterError(error, language);
    status = multerResponse.status;
    response = { ...response, ...multerResponse };
  }
  
  else if (error.code && (error.code.startsWith('23') || error.code === 'PGRST116')) {
    const supabaseResponse = handleSupabaseError(error, language);
    status = supabaseResponse.status;
    response = { ...response, ...supabaseResponse };
  }
  
  else if (error.response && error.response.data) {
    // OpenAI or external API error
    const apiResponse = handleOpenAIError(error, language);
    status = apiResponse.status;
    response = { ...response, ...apiResponse };
  }
  
  else if (ERROR_TYPES[error.message]) {
    const errorType = ERROR_TYPES[error.message];
    status = errorType.status;
    response.code = errorType.code;
    response.error = translateError(error.message.toLowerCase(), language) || error.message;
  }
  
  else if (error.message) {
    // Custom application errors
    response.error = error.message;
    
    // Try to detect error type from message
    if (error.message.includes('token')) {
      status = 401;
      response.code = 'AUTH_ERROR';
    } else if (error.message.includes('limit')) {
      status = 403;
      response.code = 'LIMIT_ERROR';
    } else if (error.message.includes('not found')) {
      status = 404;
      response.code = 'NOT_FOUND';
    } else if (error.message.includes('permission') || error.message.includes('access')) {
      status = 403;
      response.code = 'ACCESS_DENIED';
    }
  }

  // Add request context in development
  if (process.env.NODE_ENV === 'development') {
    response.debug = {
      url: req.url,
      method: req.method,
      userId: req.user?.id,
      userAgent: req.get('User-Agent')
    };
  }

  // Log significant errors
  if (status >= 500) {
    console.error(`🚨 Server Error ${status}:`, {
      error: response.error,
      code: response.code,
      url: req.url,
      method: req.method,
      userId: req.user?.id,
      stack: error.stack
    });
  } else if (status >= 400) {
    console.warn(`⚠️ Client Error ${status}:`, {
      error: response.error,
      code: response.code,
      url: req.url,
      method: req.method,
      userId: req.user?.id
    });
  }

  res.status(status).json(response);
};

// Not found handler (404)
const notFoundHandler = (req, res) => {
  console.warn(`404 - Route not found: ${req.method} ${req.url}`);
  
  const language = req.query?.language || 'en';
  
  res.status(404).json({
    error: 'Route not found',
    code: 'ROUTE_NOT_FOUND',
    method: req.method,
    url: req.url,
    timestamp: new Date().toISOString(),
    availableRoutes: process.env.NODE_ENV === 'development' ? [
      'GET /health',
      'POST /api/auth/profile',
      'GET /api/auth/usage', 
      'GET /api/auth/history',
      'POST /api/analyze',
      'GET /api/analyze/health/check'
    ] : undefined
  });
};

// Async error wrapper
const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

module.exports = {
  errorHandler,
  notFoundHandler,
  asyncHandler,
  ERROR_TYPES
};