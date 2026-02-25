function toFiniteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

module.exports = {
  toFiniteNumber,
};
