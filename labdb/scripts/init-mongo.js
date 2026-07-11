// ============================================================
// VynDB Lab — MongoDB 7 Init Script
// Runs as admin user against the labdb database
// ============================================================

// Switch to labdb database
db = db.getSiblingDB('labdb');

// Create app user with readWrite on labdb
db.createUser({
  user: 'labdb',
  pwd: 'labdb_P@ss2024',
  roles: [{ role: 'readWrite', db: 'labdb' }, { role: 'dbAdmin', db: 'labdb' }]
});

// Enable slow query profiling (log queries > 100ms)
db.setProfilingLevel(1, { slowms: 100 });

// ── Seed users collection (5,000 docs) ──────────────────────
const plans  = ['free', 'pro', 'enterprise'];
const countries = ['US', 'GB', 'DE', 'FR', 'IN', 'JP', 'BR', 'CA'];
const usersData = [];
for (let i = 1; i <= 5000; i++) {
  usersData.push({
    _id: i,
    email: `user${i}@labdb.dev`,
    name: `User ${i}`,
    plan: plans[Math.floor(Math.random() * plans.length)],
    country: countries[Math.floor(Math.random() * countries.length)],
    tags: ['web'],
    createdAt: new Date(Date.now() - Math.random() * 365 * 86400000),
    updatedAt: new Date()
  });
}
db.users.insertMany(usersData);

// ── Seed products collection (2,000 docs) ───────────────────
const categories = ['Electronics', 'Apparel', 'Books', 'Software', 'Hardware'];
const productsData = [];
for (let i = 1; i <= 2000; i++) {
  productsData.push({
    _id: i,
    name: `Product ${i}`,
    category: categories[Math.floor(Math.random() * categories.length)],
    price: Math.round(Math.random() * 999 + 1),
    stock: Math.floor(Math.random() * 1000),
    tags: ['available'],
    createdAt: new Date(Date.now() - Math.random() * 365 * 86400000)
  });
}
db.products.insertMany(productsData);

// ── Seed orders collection (50,000 docs) ────────────────────
const statuses = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];
const ordersBatch = [];
for (let i = 1; i <= 50000; i++) {
  ordersBatch.push({
    userId: Math.floor(Math.random() * 5000) + 1,
    status: statuses[Math.floor(Math.random() * statuses.length)],
    total: Math.round(Math.random() * 5000 + 10),
    items: Math.floor(Math.random() * 10 + 1),
    createdAt: new Date(Date.now() - Math.random() * 180 * 86400000),
    shippedAt: Math.random() > 0.3 ? new Date(Date.now() - Math.random() * 90 * 86400000) : null
  });
  if (ordersBatch.length === 5000) {
    db.orders.insertMany(ordersBatch);
    ordersBatch.length = 0;
  }
}
if (ordersBatch.length > 0) db.orders.insertMany(ordersBatch);

// ── Seed events collection (200,000 docs) ───────────────────
const eventTypes = ['page_view', 'click', 'purchase', 'signup', 'logout', 'search'];
const eventsBatch = [];
for (let i = 1; i <= 200000; i++) {
  eventsBatch.push({
    userId: Math.floor(Math.random() * 5000) + 1,    // no compound index (slow query demo)
    eventType: eventTypes[Math.floor(Math.random() * eventTypes.length)],
    page: `/page/${Math.floor(Math.random() * 100) + 1}`,
    sessionId: `sess${Math.floor(Math.random() * 100000)}`,
    createdAt: new Date(Date.now() - Math.random() * 90 * 86400000),
    meta: { source: ['web', 'mobile', 'api'][Math.floor(Math.random() * 3)] }
  });
  if (eventsBatch.length === 10000) {
    db.events.insertMany(eventsBatch);
    eventsBatch.length = 0;
  }
}
if (eventsBatch.length > 0) db.events.insertMany(eventsBatch);

// ── Indexes (sparse — events.userId intentionally NOT indexed) ──
db.users.createIndex({ email: 1 }, { unique: true });
db.orders.createIndex({ status: 1 });
db.orders.createIndex({ createdAt: -1 });
db.events.createIndex({ eventType: 1 });
// NOTE: { userId: 1, createdAt: -1 } compound index intentionally missing on events

print('MongoDB lab data seeded successfully.');
print('Collections: users(5k), products(2k), orders(50k), events(200k)');
