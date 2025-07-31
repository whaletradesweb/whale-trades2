module.exports = async (req, res) => {
  res.json({
    message: "Open Interest Debug endpoint active",
    note: "KV storage is currently disabled, only API fetch is used."
  });
};
