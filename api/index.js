// Vercel function entry. The Nest app is compiled to dist/ by `npm run build`.
module.exports = (req, res) => require('../dist/serverless').default(req, res);
