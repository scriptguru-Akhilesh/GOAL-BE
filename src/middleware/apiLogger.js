function apiLogger(req, res, next) {
  const start = Date.now();
  const timestamp = new Date().toISOString();

  console.log('\n┌─── API REQUEST ───────────────────────────────');
  console.log(`│ ${timestamp}`);
  console.log(`│ ${req.method} ${req.originalUrl}`);

  if (Object.keys(req.query || {}).length > 0) {
    console.log('│ Query:', JSON.stringify(req.query));
  }

  if (req.method !== 'GET' && req.body && Object.keys(req.body).length > 0) {
    console.log('│ Body:', JSON.stringify(req.body, null, 2).split('\n').join('\n│ '));
  }

  const originalJson = res.json.bind(res);
  const originalSend = res.send.bind(res);

  res.json = (data) => {
    logResponse(res.statusCode, data, start);
    return originalJson(data);
  };

  res.send = (data) => {
    let parsed = data;
    try {
      if (typeof data === 'string') parsed = JSON.parse(data);
    } catch {
      parsed = data;
    }
    logResponse(res.statusCode, parsed, start);
    return originalSend(data);
  };

  next();
}

function logResponse(statusCode, data, start) {
  const ms = Date.now() - start;
  const isError = statusCode >= 400;

  console.log(isError ? '├─── API ERROR RESPONSE ───────────────────────' : '├─── API RESPONSE ──────────────────────────────');
  console.log(`│ Status: ${statusCode} (${ms}ms)`);
  console.log(`│ Data: ${JSON.stringify(data, null, 2).split('\n').join('\n│ ')}`);
  console.log('└──────────────────────────────────────────────\n');
}

function logServerError(err, req) {
  console.error('\n┌─── SERVER ERROR ──────────────────────────────');
  console.error(`│ ${req.method} ${req.originalUrl}`);
  console.error(`│ Message: ${err.message}`);
  if (err.stack) {
    console.error('│ Stack:', err.stack.split('\n').slice(0, 5).join('\n│ '));
  }
  console.error('└──────────────────────────────────────────────\n');
}

module.exports = { apiLogger, logServerError };
