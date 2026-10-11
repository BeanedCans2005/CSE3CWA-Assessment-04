export const BRAIN_CONFIG = {
    leadTimeDays: 1,
    trailingDays: 7,                        // sales window for the average
    minDemandFloor: 0.3,                    // units/day, avoids divide-by-zero and overreaction to low sales
    lowStockCoverDays: { perishable: 1.0, nonPerishable: 3 },
    slowMoverCoverDays: 35,                 // stock / avg daily sales
    slowMoverMinDays: 7,                    // need a week of data first
    slowMoverReemitDays: 7,
    expiryWarnWithinDays: 2,
    reorderPointCoverDays: 4,               // non-perishables reorder at or below this cover
    targetCover: { nonPerishable: 10, perishableMin: 1.3, perishableMax: 3 },
    perishableSafety: 1.15,                  // safety factor for perishable cover
}