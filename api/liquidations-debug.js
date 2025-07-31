const { kv } = require("@vercel/kv");

module.exports = async (req, res) => {
  try {
    const { action } = req.query;

    if (action === "reset") {
      await kv.del("liquidations:previous_total");
      await kv.del("liquidations:timestamp");
      return res.json({ message: "✅ Baseline reset successfully" });
    }

    // View stored values
    const previousTotal = await kv.get("liquidations:previous_total");
    const previousTimestamp = await kv.get("liquidations:timestamp");

    res.json({
      previous_total: previousTotal || "Not set",
      previous_timestamp: previousTimestamp 
        ? new Date(previousTimestamp).toUTCString() 
        : "Not set"
    });

  } catch (err) {
    console.error("Debug endpoint error:", err.message);
    res.status(500).json({ error: "Failed to fetch debug info" });
  }
};
