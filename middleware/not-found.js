const notFound = (req, res) => {
  console.log(`❌ 404 Not Found: ${req.method} ${req.url}`);
  console.log(`   Headers:`, req.headers);
  res.status(404).send('Route does not exist');
};

export default notFound;
