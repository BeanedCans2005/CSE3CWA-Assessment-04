import fs from 'node:fs';


// [id, name, category, costCents, priceCents, openingQty, shelfLifeDays|null]
const rows = [
  // ---- Grocery & Pantry (non-perishable) ----
  ['G01','Spaghetti 500g','Grocery & Pantry',90,180,300],
  ['G02','Basmati Rice 1kg','Grocery & Pantry',220,399,200],
  ['G03','Pasta Sauce 500g Jar','Grocery & Pantry',160,320,250],
  ['G04','Canned Tomatoes 400g','Grocery & Pantry',80,160,350],
  ['G05','Baked Beans 420g','Grocery & Pantry',85,170,300],
  ['G06','Tuna in Springwater 95g','Grocery & Pantry',100,220,350],
  ['G07','Breakfast Cereal 500g','Grocery & Pantry',300,550,200],
  ['G08','Rolled Oats 750g','Grocery & Pantry',180,350,150],
  ['G09','Cup Noodles 70g','Grocery & Pantry',70,180,500],
  ['G10','Peanut Butter 375g','Grocery & Pantry',200,420,150],
  ['G11','Olive Oil 500ml','Grocery & Pantry',500,850,120],
  ['G12','Tea Bags 100pk','Grocery & Pantry',220,450,150],
  ['G13','Instant Coffee 100g','Grocery & Pantry',350,650,120],

  // ---- Drinks ----
  ['D01','Still Water 600ml','Drinks',55,220,800],
  ['D02','Sparkling Mineral Water 1L','Drinks',100,280,250],
  ['D03','Cola 600ml','Drinks',130,380,700],
  ['D04','Lemonade 600ml','Drinks',120,360,400],
  ['D05','Energy Drink 250ml','Drinks',150,390,500],
  ['D06','Sports Drink 600ml','Drinks',160,400,300],
  ['D07','Iced Tea 500ml','Drinks',120,350,400],

  // ---- Snacks & Confectionery ----
  ['S01','Potato Chips 175g','Snacks & Confectionery',180,420,400],
  ['S02','Corn Chips 230g','Snacks & Confectionery',170,380,250],
  ['S03','Chocolate Block 180g','Snacks & Confectionery',220,480,350],
  ['S04','Chocolate Bar 50g','Snacks & Confectionery',90,250,600],
  ['S05','Muesli Bars 6pk','Snacks & Confectionery',220,450,200],
  ['S06','Plain Biscuits 250g','Snacks & Confectionery',120,280,300],
  ['S07','Lollies 200g','Snacks & Confectionery',150,350,300],
  ['S08','Chewing Gum','Snacks & Confectionery',70,220,400],

  // ---- Dairy & Chilled (perishable) ----
  ['C01','Full Cream Milk 2L','Dairy & Chilled',200,360,250,8],
  ['C02','Full Cream Milk 1L','Dairy & Chilled',110,210,200,8],
  ['C03','Natural Yoghurt 500g','Dairy & Chilled',200,420,120,14],
  ['C04','Fruit Yoghurt 170g','Dairy & Chilled',80,180,300,14],
  ['C05','Cheddar Cheese 500g','Dairy & Chilled',500,850,100,45],
  ['C06','Free Range Eggs 12pk','Dairy & Chilled',400,680,150,21],
  ['C07','Chilled Orange Juice 1L','Dairy & Chilled',230,480,150,10],
  ['C08','Iced Coffee 500ml','Dairy & Chilled',180,450,300,14],
  ['C09','Sliced Ham 200g','Dairy & Chilled',300,550,100,7],

  // ---- Fresh & Bakery (perishable) ----
  ['F01','Sliced White Bread 650g','Fresh & Bakery',140,350,150,4],
  ['F02','Wholemeal Bread 700g','Fresh & Bakery',160,380,100,4],
  ['F03','Croissant','Fresh & Bakery',100,320,80,2],
  ['F04','Bananas 1kg','Fresh & Bakery',180,390,120,5],
  ['F05','Apples 1kg','Fresh & Bakery',220,490,100,10],
  ['F06','Tomatoes 500g','Fresh & Bakery',200,450,80,6],
  ['F07','Salad Mix 200g','Fresh & Bakery',180,400,80,5],

  // ---- Ready-to-Eat (perishable, short life) ----
  ['R01','Ham & Cheese Sandwich','Ready-to-Eat',220,550,80,2],
  ['R02','Chicken Wrap','Ready-to-Eat',260,650,70,2],
  ['R03','Sushi Pack 8pc','Ready-to-Eat',320,750,50,2],
  ['R04','Pasta Salad Bowl','Ready-to-Eat',280,650,60,3],
  ['R05','Meat Pie','Ready-to-Eat',180,480,60,3],
  ['R06','Microwave Meal 350g (chilled)','Ready-to-Eat',320,690,100,10],

  // ---- Household ----
  ['H01','Paper Towel 2pk','Household',250,480,150],
  ['H02','Toilet Paper 12pk','Household',600,1050,150],
  ['H03','Dishwashing Liquid 500ml','Household',200,400,120],
  ['H04','Laundry Liquid 1L','Household',450,850,100],
  ['H05','Garbage Bags 30pk','Household',250,480,100],
  ['H06','Batteries AA 4pk','Household',350,750,100],

  // ---- Personal & Convenience ----
  ['P01','Toothpaste 110g','Personal & Convenience',200,450,120],
  ['P02','Toothbrush','Personal & Convenience',120,350,100],
  ['P03','Shampoo 400ml','Personal & Convenience',350,750,100],
  ['P04','Deodorant 150ml','Personal & Convenience',300,650,100],
  ['P05','Bandage Strips 20pk','Personal & Convenience',200,450,80],
  ['P06','Compact Umbrella','Personal & Convenience',600,1400,40],
  ['P07','Phone Charging Cable','Personal & Convenience',400,1200,40],
];

const qtyFile = new URL('./openingQty.json', import.meta.url);
const OPENING_QTY = fs.existsSync(qtyFile)
  ? JSON.parse(fs.readFileSync(qtyFile, 'utf8'))
  : {};

export const PRODUCTS = rows.map(([id, name, category, cost, price, qty, shelf]) => ({
  product_id: id,
  name,
  category,
  unit_cost_cents: cost,
  unit_price_cents: price,
  initial_qty: OPENING_QTY[id] ?? qty,
  is_perishable: shelf ? 1 : 0,
  shelf_life_days: shelf ?? null,
}));

export function openingInventoryCostCents(products = PRODUCTS) {
  return products.reduce((s, p) => s + p.unit_cost_cents * p.initial_qty, 0);
}

// Hard guard: the seed script should call this before creating a run.
export function assertWithinBudget(budgetCents = 4_000_000) {
  const total = openingInventoryCostCents();
  if (total > budgetCents) {
    throw new Error(`Opening inventory A$${(total/100).toFixed(2)} exceeds budget`);
  }
  return total;
}