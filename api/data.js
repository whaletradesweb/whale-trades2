module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const { type } = req.query;

  switch (type) {
    case "debug-env": {
      const key = process.env.COINGLASS_API_KEY;
      return res.json({
        exists: !!key,
        length: key ? key.length : 0,
        masked: key ? key.slice(0, 4) + "****" : null,
        environment: process.env.VERCEL_ENV || "unknown"
      });
    }

    default:
      return res.status(400).json({ error: "Invalid type parameter" });
  }
};
