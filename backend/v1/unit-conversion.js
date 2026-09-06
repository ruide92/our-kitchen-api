// Shared unit conversion helper for Shopping and Cooking services.
// Only converts within known dimensions (MASS, VOLUME). Never guesses
// COUNT <-> MASS <-> VOLUME. Both services must use this single source
// of truth to prevent conversion drift.

// Convert a quantity to the base unit of its dimension.
// Returns { quantity, unitCode, converted }.
// If unit is unknown or has no to_base_factor, converted=false and values unchanged.
function toBaseQuantity(quantity, unitCode, unitsMap) {
  if (quantity == null || !unitCode) return { quantity, unitCode, converted: false };
  const unit = unitsMap.get(unitCode);
  if (!unit || !unit.to_base_factor) return { quantity, unitCode, converted: false };
  const baseCode = unit.dimension === 'MASS' ? 'g' : unit.dimension === 'VOLUME' ? 'ml' : unitCode;
  return { quantity: quantity * unit.to_base_factor, unitCode: baseCode, converted: true };
}

// Convert a quantity from base unit back to a target unit.
// Returns { quantity, converted }. Only works if target unit has to_base_factor.
function fromBaseQuantity(baseQuantity, targetUnitCode, unitsMap) {
  if (baseQuantity == null || !targetUnitCode) return { quantity: baseQuantity, converted: false };
  const unit = unitsMap.get(targetUnitCode);
  if (!unit || !unit.to_base_factor) return { quantity: baseQuantity, converted: false };
  return { quantity: baseQuantity / unit.to_base_factor, converted: true };
}

// Check if two units are in the same convertible dimension.
// MASS and VOLUME: same dimension + both have to_base_factor → compatible.
// COUNT and TEXT: only exact same unit code is compatible (no implicit 1:1
// conversion between piece/root/bottle etc. unless an explicit contract exists).
// Unknown units are not compatible with anything except exact match.
function areUnitsCompatible(unitCode1, unitCode2, unitsMap) {
  if (unitCode1 === unitCode2) return true;
  const u1 = unitsMap.get(unitCode1);
  const u2 = unitsMap.get(unitCode2);
  if (!u1 || !u2 || !u1.dimension || !u2.dimension) return false;
  // Only MASS and VOLUME allow cross-code dimension conversion.
  if (u1.dimension !== 'MASS' && u1.dimension !== 'VOLUME') return false;
  return u1.dimension === u2.dimension && u1.to_base_factor && u2.to_base_factor;
}

// Load units table into a Map keyed by code.
async function loadUnitsMap(tx) {
  const rows = (await tx.query('SELECT code, dimension, to_base_factor FROM units')).rows;
  const map = new Map();
  for (const r of rows) {
    map.set(r.code, { dimension: r.dimension, to_base_factor: r.to_base_factor != null ? Number(r.to_base_factor) : null });
  }
  return map;
}

module.exports = { toBaseQuantity, fromBaseQuantity, areUnitsCompatible, loadUnitsMap };
