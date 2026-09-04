class ApiError extends Error {
  constructor(status, code, message, details = null) {
    super(message);
    Object.assign(this, { status, code, details });
  }
}

function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  if (error.type === 'entity.parse.failed') error = new ApiError(400, 'INVALID_JSON', 'JSON 格式错误');
  if (error.type === 'entity.too.large') error = new ApiError(413, 'PAYLOAD_TOO_LARGE', '请求过大');
  const known = error instanceof ApiError;
  res.status(known ? error.status : 500).json({ error: {
    code: known ? error.code : 'INTERNAL_ERROR',
    message: known ? error.message : '服务器内部错误',
    details: known ? error.details : null
  } });
}

module.exports = { ApiError, errorHandler };
