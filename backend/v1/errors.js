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
  if (!(error instanceof ApiError) && error.code === '23505') error = new ApiError(409,'CONFLICT','记录已存在');
  if (!(error instanceof ApiError) && ['23503','23514','22003'].includes(error.code)) error = new ApiError(422,'VALIDATION_ERROR','数据约束校验失败');
  const known = error instanceof ApiError;
  res.status(known ? error.status : 500).json({ error: {
    code: known ? error.code : 'INTERNAL_ERROR',
    message: known ? error.message : '服务器内部错误',
    details: known ? error.details : null
  } });
}

module.exports = { ApiError, errorHandler };
