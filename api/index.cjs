/**
 * CommonJS Vercel entry — dynamically imports the ESM Express app.
 * Avoids ERR_REQUIRE_ESM and surfaces bootstrap errors as JSON.
 */
module.exports = async function handler(req, res) {
  const origin = req.headers.origin || '*';
  const setCors = () => {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, X-Branch-Id'
    );
  };

  if (req.method === 'OPTIONS') {
    setCors();
    res.statusCode = 204;
    res.end();
    return;
  }

  try {
    const mod = await import('../server.js');
    const app = mod.default;
    if (typeof app !== 'function') {
      throw new Error('Express app export is missing or invalid.');
    }
    return app(req, res);
  } catch (err) {
    console.error('Vercel bootstrap failed:', err);
    setCors();
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(
      JSON.stringify({
        success: false,
        message: 'Server failed to start',
        error: err && err.message ? err.message : String(err),
      })
    );
  }
};
