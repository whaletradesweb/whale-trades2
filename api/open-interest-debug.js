const { kv } = require("@vercel/kv");

module.exports = async (req, res) => {
  try {
    const { action } = req.query;

    // ✅ Reset baseline
    if (action === "reset") {
      await kv.del("open_interest:previous_total");
      await kv.del("open_interest:timestamp");
      return res.json({ message: "✅ Open Interest baseline reset successfully" });
    }

    // ✅ View stored baseline
    const previousTotal = await kv.get("open_interest:previous_total");
    const previousTimestamp = await kv.get("open_interest:timestamp");

    res.json({
      previous_total: previousTotal || "Not set",
      previous_timestamp: previousTimestamp
        ? new Date(previousTimestamp).toUTCString()
        : "Not set"
    });
  } catch (err) {
    console.error("Open Interest Debug Error:", err.message);
    res.status(500).json({ error: "Failed to fetch Open Interest debug info", message: err.message });
  }
};
