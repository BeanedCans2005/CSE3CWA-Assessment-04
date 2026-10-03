const tierIds = {
  A: ['D01','D03','D05','S01','S04','C01','C02','C08','F01','F04','R01','R02','G09'],
  B: ['G01','G02','G03','G04','G05','G06','G07','D02','D04','D06','D07',
      'S02','S03','S05','S06','S07','C03','C04','C06','C07',
      'F02','F03','F05','F06','F07','R03','R04','R05','R06',
      'H01','H02','H03','H05','P01','P04'],
  C: ['G08','G10','G11','G12','G13','S08','C05','C09','H04','H06',
      'P02','P03','P05','P06','P07'],
};

export const DEMAND_CONFIG = {
    // Day 1 = Mondey. Weekday index 0..6 = Mon..Sun.
    baseVisitorsPerDay: 300,
    weekdayFactor: [0.95, 1.00, 1.00, 1.05, 1.15, 0.85, 0.70],
    dayNoiseSigma: 0.08,                // lognormal day-to-day variation

    rainProbability: 0.18,
    rainTrafficFactorL: 0.92,
    rainUmbrellaFactor: 10,             // multiplies popularity of P06 on rainy days

    // One scheduled event: Saturday of week 3
    events: [{
        day: 20, tag: 'TOWN_HALL_EVENT', trafficFactor: 1.6,
        categoryBoost: { 'Drinks': 1.4, 'Snacks & Confectionery': 1.4 },
    }],

    // 24 hourly weights (hour 0..23), normalised in code
     hourlyWeights: {
    weekday: [0.2,0.1,0.1,0.1,0.2,0.6,2.0,5.5,8.0,5.5,4.0,5.5,
              9.5,9.0,5.5,4.5,5.5,9.0,8.5,5.5,3.5,2.5,1.5,0.8],
    weekend: [0.5,0.3,0.2,0.1,0.1,0.3,0.8,1.8,3.5,5.5,7.5,9.0,
              9.5,9.0,8.5,8.0,7.0,6.0,5.5,4.5,3.5,2.5,1.8,1.0],
  },

  browseOnlyProbability: 0.06,         // visits but buys nothing

  missions: {
    GRAB_AND_GO: { meanLines: 1.6, categories: { 'Drinks': 4, 'Snacks & Confectionery': 3, 'Fresh & Bakery': 1.5, 'Dairy & Chilled': 1.5 } },
    LUNCH_RUN:   { meanLines: 2.8, categories: { 'Ready-to-Eat': 5, 'Drinks': 3, 'Snacks & Confectionery': 2, 'Fresh & Bakery': 1 } },
    TOP_UP:      { meanLines: 4.5, categories: { 'Grocery & Pantry': 4, 'Dairy & Chilled': 3, 'Fresh & Bakery': 2.5, 'Household': 1, 'Drinks': 1 } },
    DINNER:      { meanLines: 4.0, categories: { 'Grocery & Pantry': 3, 'Dairy & Chilled': 2, 'Fresh & Bakery': 2.5, 'Ready-to-Eat': 2.5, 'Drinks': 1 } },
    ESSENTIALS:  { meanLines: 3.2, categories: { 'Household': 4, 'Personal & Convenience': 3, 'Grocery & Pantry': 1.5 } },
    URGENT_NEED: { meanLines: 1.3, categories: { 'Personal & Convenience': 5, 'Household': 1.5, 'Drinks': 1 } },
  },

  // Mission weights by time block (hours: morning 5-10, lunch 11-14,
  // afternoon 15-18. evening 17-20, night 21-4)
   missionMix: {
    morning:   { GRAB_AND_GO: 60, LUNCH_RUN: 5,  TOP_UP: 15, DINNER: 0,  ESSENTIALS: 8,  URGENT_NEED: 12 },
    lunch:     { GRAB_AND_GO: 15, LUNCH_RUN: 60, TOP_UP: 10, DINNER: 0,  ESSENTIALS: 5,  URGENT_NEED: 10 },
    afternoon: { GRAB_AND_GO: 35, LUNCH_RUN: 10, TOP_UP: 25, DINNER: 5,  ESSENTIALS: 10, URGENT_NEED: 15 },
    evening:   { GRAB_AND_GO: 12, LUNCH_RUN: 3,  TOP_UP: 25, DINNER: 38, ESSENTIALS: 12, URGENT_NEED: 10 },
    late:      { GRAB_AND_GO: 40, LUNCH_RUN: 0,  TOP_UP: 10, DINNER: 10, ESSENTIALS: 10, URGENT_NEED: 30 },
  },
  weekendMissionFactor: { GRAB_AND_GO: 0.8, LUNCH_RUN: 0.6, TOP_UP: 1.6, DINNER: 1.0, ESSENTIALS: 1.5, URGENT_NEED: 1.0 },

  maxLines: 10,
  extraUnitProb: [0.18, 0.05],         // P(2nd unit), P(3rd unit) per line

  tierWeight: { A: 5, B: 2, C: 0.5 },  // product popularity within its category
  tier: Object.fromEntries(
    Object.entries(tierIds).flatMap(([t, ids]) => ids.map(id => [id, t]))
  ),

  substituteProbability: 0.35,         // if out of stock: swap within category
};