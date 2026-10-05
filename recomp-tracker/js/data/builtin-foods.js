// Built-in food database. Values are approximate, per 100 g / 100 ml (or per
// serving where unit is 'serving'), rounded from public USDA FoodData Central
// style figures. Real products vary: weigh and check labels when it matters, and
// add your own foods (More > Foods) for anything you eat often.
//
// Fields: id, name, th (Thai name), cat, unit, basis, p/c/f (g), a (alcohol g),
// cr (cooked weight / raw weight, for display only), est (rough estimate).

const food = (id, name, th, cat, p, c, f, extra = {}) => ({
  id,
  name,
  th,
  cat,
  unit: 'g',
  basis: 100,
  p,
  c,
  f,
  a: 0,
  ...extra,
});

export const BUILTIN_FOODS = [
  // ---- Protein (raw weight unless the name says cooked) ----
  food('chicken-breast-raw', 'Chicken breast, raw', 'อกไก่ ดิบ', 'protein', 22.5, 0, 2.6, { cr: 0.75 }),
  food('chicken-breast-cooked', 'Chicken breast, cooked', 'อกไก่ สุก', 'protein', 31, 0, 3.6),
  food('chicken-tenderloin-raw', 'Chicken tenderloin, raw', 'สันในไก่ ดิบ', 'protein', 22.7, 0, 1.5, { cr: 0.77 }),
  food('chicken-thigh-raw', 'Chicken thigh (skinless), raw', 'น่องสะโพกไก่ ไม่มีหนัง ดิบ', 'protein', 19.7, 0, 4.1, { cr: 0.75 }),
  food('egg-whole', 'Egg, whole', 'ไข่ไก่ทั้งฟอง', 'protein', 12.6, 0.7, 9.5),
  food('egg-white', 'Egg white', 'ไข่ขาว', 'protein', 10.9, 0.7, 0.2),
  food('shrimp-raw', 'Shrimp, raw', 'กุ้ง ดิบ', 'protein', 20.1, 0.2, 0.5, { cr: 0.85 }),
  food('salmon-raw', 'Salmon, raw', 'แซลมอน ดิบ', 'protein', 20.4, 0, 13.4, { cr: 0.8 }),
  food('sea-bass-raw', 'Sea bass, raw', 'ปลากะพง ดิบ', 'protein', 18.4, 0, 2, { cr: 0.78 }),
  food('tilapia-raw', 'Tilapia, raw', 'ปลานิล ดิบ', 'protein', 20.1, 0, 1.7, { cr: 0.75 }),
  food('tuna-canned-water', 'Tuna, canned in water (drained)', 'ทูน่ากระป๋อง ในน้ำแร่', 'protein', 25.5, 0, 0.8),
  food('pork-tenderloin-raw', 'Pork tenderloin, raw', 'สันในหมู ดิบ', 'protein', 20.9, 0, 3.5, { cr: 0.75 }),
  food('beef-sirloin-raw', 'Beef sirloin, lean, raw', 'เนื้อสันนอกวัว ดิบ', 'protein', 21, 0, 5, { cr: 0.75 }),
  food('beef-ground-95-raw', 'Ground beef 95% lean, raw', 'เนื้อบดไขมันต่ำ ดิบ', 'protein', 21.4, 0, 5, { cr: 0.75 }),
  food('whey-isolate', 'Whey protein isolate', 'เวย์โปรตีน ไอโซเลท', 'protein', 90, 1.5, 1.2),
  food('whey-concentrate', 'Whey protein concentrate', 'เวย์โปรตีน คอนเซนเตรท', 'protein', 80, 8, 4),
  food('greek-yogurt-nonfat', 'Greek yogurt, plain, nonfat', 'กรีกโยเกิร์ต ไม่มีไขมัน', 'dairy', 10.3, 3.6, 0.4),
  food('milk-whole', 'Milk, whole', 'นมสด', 'dairy', 3.3, 4.8, 3.3, { unit: 'ml' }),
  food('milk-skim', 'Milk, skim', 'นมพร่องมันเนย', 'dairy', 3.4, 5, 0.1, { unit: 'ml' }),

  // ---- Carbs ----
  food('rice-white-raw', 'White / jasmine rice, uncooked', 'ข้าวสาร (ขาว/หอมมะลิ)', 'carb', 7.1, 80, 0.7, { cr: 2.74 }),
  food('rice-white-cooked', 'White / jasmine rice, cooked', 'ข้าวสวย', 'carb', 2.7, 28.2, 0.3),
  food('rice-brown-raw', 'Brown rice, uncooked', 'ข้าวกล้อง ดิบ', 'carb', 7.9, 77.2, 2.9, { cr: 2.73 }),
  food('rice-brown-cooked', 'Brown rice, cooked', 'ข้าวกล้อง สุก', 'carb', 2.6, 23, 0.9),
  food('oats-raw', 'Rolled oats, dry', 'ข้าวโอ๊ต', 'carb', 13.2, 67.7, 6.5),
  food('bread-white', 'White bread', 'ขนมปังขาว', 'carb', 9, 49, 3.2),
  food('bread-wholewheat', 'Whole-wheat bread', 'ขนมปังโฮลวีท', 'carb', 12.5, 42.7, 3.5),
  food('pasta-dry', 'Pasta, dry', 'พาสต้า ดิบ', 'carb', 13, 74.7, 1.5, { cr: 3 }),
  food('pasta-cooked', 'Pasta, cooked', 'พาสต้า สุก', 'carb', 5.8, 31, 0.9),
  food('rice-noodles-cooked', 'Rice noodles, cooked', 'เส้นเล็ก สุก', 'carb', 0.9, 24.9, 0.2),
  food('sweet-potato-baked', 'Sweet potato, baked', 'มันเทศอบ', 'carb', 2, 20.7, 0.2),
  food('potato-boiled', 'Potato, boiled', 'มันฝรั่งต้ม', 'carb', 1.9, 20.1, 0.1),
  food('honey', 'Honey', 'น้ำผึ้ง', 'carb', 0.3, 82.4, 0),

  // ---- Fruit ----
  food('banana', 'Banana', 'กล้วย', 'fruit', 1.1, 22.8, 0.3),
  food('apple', 'Apple', 'แอปเปิล', 'fruit', 0.3, 13.8, 0.2),
  food('mango', 'Mango', 'มะม่วง', 'fruit', 0.8, 15, 0.4),
  food('papaya', 'Papaya', 'มะละกอ', 'fruit', 0.5, 11, 0.3),
  food('pineapple', 'Pineapple', 'สับปะรด', 'fruit', 0.5, 13.1, 0.1),
  food('orange', 'Orange', 'ส้ม', 'fruit', 0.9, 11.8, 0.1),
  food('watermelon', 'Watermelon', 'แตงโม', 'fruit', 0.6, 7.6, 0.2),

  // ---- Fats ----
  food('olive-oil', 'Olive oil', 'น้ำมันมะกอก', 'fat', 0, 0, 100),
  food('coconut-oil', 'Coconut oil', 'น้ำมันมะพร้าว', 'fat', 0, 0, 100),
  food('avocado', 'Avocado', 'อโวคาโด', 'fat', 2, 8.5, 14.7),
  food('peanut-butter', 'Peanut butter', 'เนยถั่ว', 'fat', 25, 20, 50),
  food('almonds', 'Almonds', 'อัลมอนด์', 'fat', 21.2, 21.6, 49.9),
  food('macadamia', 'Macadamia nuts', 'แมคคาเดเมีย', 'fat', 7.9, 13.8, 75.8),
  food('pistachio', 'Pistachios', 'พิสตาชิโอ', 'fat', 20.2, 27.2, 45.3),
  food('cashew', 'Cashew nuts', 'เม็ดมะม่วงหิมพานต์', 'fat', 18.2, 30.2, 43.9),
  food('walnuts', 'Walnuts', 'วอลนัท', 'fat', 15.2, 13.7, 65.2),
  food('peanuts', 'Peanuts', 'ถั่วลิสง', 'fat', 25.8, 16.1, 49.2),
  food('butter', 'Butter', 'เนย', 'fat', 0.9, 0.1, 81.1),

  // ---- Vegetables ----
  food('broccoli', 'Broccoli', 'บรอกโคลี', 'veg', 2.8, 6.6, 0.4),
  food('spinach', 'Spinach', 'ผักโขม', 'veg', 2.9, 3.6, 0.4),
  food('cucumber', 'Cucumber', 'แตงกวา', 'veg', 0.7, 3.6, 0.1),
  food('tomato', 'Tomato', 'มะเขือเทศ', 'veg', 0.9, 3.9, 0.2),
  food('carrot', 'Carrot', 'แครอท', 'veg', 0.9, 9.6, 0.2),
  food('cabbage', 'Cabbage', 'กะหล่ำปลี', 'veg', 1.3, 5.8, 0.1),
  food('green-beans', 'Green beans', 'ถั่วฝักยาว/ถั่วแขก', 'veg', 1.8, 7, 0.2),
  food('mushroom', 'Mushrooms', 'เห็ด', 'veg', 3.1, 3.3, 0.3),

  // ---- Drinks (alcohol is tracked in grams of ethanol, 7 kcal/g) ----
  food('beer-5', 'Beer (5%)', 'เบียร์', 'drink', 0.5, 3.6, 0, { unit: 'ml', a: 3.9 }),
  food('wine-12', 'Wine (12%)', 'ไวน์', 'drink', 0.1, 2.6, 0, { unit: 'ml', a: 9.5 }),
  food('spirits-40', 'Spirits (40%)', 'เหล้า/วิสกี้', 'drink', 0, 0, 0, { unit: 'ml', a: 31.6 }),
  food('soda-cola', 'Cola', 'น้ำอัดลม', 'drink', 0, 10.6, 0, { unit: 'ml' }),
  food('zero-jelly', 'Zero-calorie jelly / syrup', 'เยลลี่/ไซรัป 0 แคล', 'other', 0, 0, 0),

  // ---- Common dishes: ROUGH per-serving estimates (±25% or worse). ----
  // Handy for off-plan meals when you cannot weigh; prefer weighing, or ask an
  // AI with a photo, and edit the numbers if you know better.
  food('dish-pad-krapow-rice', 'Pad kra pao (pork) + rice + fried egg', 'ข้าวกะเพราหมูไข่ดาว', 'dish', 28, 70, 28, { unit: 'serving', basis: 1, est: true }),
  food('dish-fried-rice', 'Fried rice with chicken (1 plate)', 'ข้าวผัดไก่', 'dish', 20, 78, 20, { unit: 'serving', basis: 1, est: true }),
  food('dish-pad-thai', 'Pad Thai (1 plate)', 'ผัดไทย', 'dish', 22, 85, 25, { unit: 'serving', basis: 1, est: true }),
  food('dish-noodle-soup', 'Noodle soup with pork (1 bowl)', 'ก๋วยเตี๋ยวน้ำหมู', 'dish', 20, 50, 10, { unit: 'serving', basis: 1, est: true }),
  food('dish-chicken-rice', 'Hainanese chicken rice (1 plate)', 'ข้าวมันไก่', 'dish', 28, 80, 22, { unit: 'serving', basis: 1, est: true }),
  food('dish-ramen', 'Tonkotsu ramen (1 bowl)', 'ราเมน', 'dish', 30, 85, 30, { unit: 'serving', basis: 1, est: true }),
  food('dish-som-tam', 'Papaya salad (som tam)', 'ส้มตำ', 'dish', 4, 22, 2.5, { unit: 'serving', basis: 1, est: true }),
  food('dish-grilled-chicken', 'Grilled chicken, 1 portion (~150 g cooked)', 'ไก่ย่าง 1 ส่วน', 'dish', 36, 2, 12, { unit: 'serving', basis: 1, est: true }),
  food('dish-steak-200', 'Sirloin steak, ~200 g cooked', 'สเต็กเนื้อ ~200 ก.', 'dish', 52, 0, 24, { unit: 'serving', basis: 1, est: true }),
];
