import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'

import type { QueryResult } from '../types'

type CustomerRow = {
  customer_id: number
  customer_name: string
  country: string
  city: string
  signup_date: string
  acquisition_channel: string
  segment: string
  last_active_date: string
}

type ProductRow = {
  product_id: number
  product_name: string
  category_id: number
  price: number
  cost: number
  launch_date: string
  status: string
}

let sqlModulePromise: Promise<SqlJsStatic> | null = null

const resolveNodeWasmPath = () => {
  const url = new URL('../../node_modules/sql.js/dist/sql-wasm.wasm', import.meta.url)
  const pathname = decodeURIComponent(url.pathname)

  return pathname.startsWith('/') && /^[A-Za-z]:/.test(pathname.slice(1)) ? pathname.slice(1) : pathname
}

const getWasmLocation = () => (typeof window === 'undefined' ? resolveNodeWasmPath() : wasmUrl)

const getSqlModule = () => {
  if (!sqlModulePromise) {
    sqlModulePromise = initSqlJs({
      locateFile: () => getWasmLocation(),
    })
  }

  return sqlModulePromise
}

const pad = (value: number) => String(value).padStart(2, '0')

const dateFromIndex = (year: number, monthSeed: number, daySeed: number) =>
  `${year}-${pad(((monthSeed - 1) % 12) + 1)}-${pad(((daySeed - 1) % 28) + 1)}`

const escapeSql = (value: string) => value.replaceAll("'", "''")

const sqlValue = (value: number | string | null) => {
  if (value === null) {
    return 'NULL'
  }

  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : value.toFixed(2)
  }

  return `'${escapeSql(value)}'`
}

const insertRows = (table: string, columns: string[], rows: Array<Array<number | string | null>>) =>
  rows
    .map(
      (row) =>
        `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${row.map((value) => sqlValue(value)).join(', ')});`,
    )
    .join('\n')

const normalizeVariantSeed = (variantSeed: number) => Math.abs(Math.trunc(variantSeed)) % 7

const createCustomers = (variantOffset = 0): CustomerRow[] => {
  const countries = ['Australia', 'United States', 'United Kingdom', 'Canada', 'Germany']
  const citiesByCountry: Record<string, string[]> = {
    Australia: ['Sydney', 'Melbourne', 'Brisbane', 'Perth'],
    'United States': ['New York', 'Austin', 'Seattle', 'Chicago'],
    'United Kingdom': ['London', 'Manchester', 'Bristol', 'Leeds'],
    Canada: ['Toronto', 'Vancouver', 'Montreal', 'Calgary'],
    Germany: ['Berlin', 'Munich', 'Hamburg', 'Cologne'],
  }
  const channels = ['Organic Search', 'Paid Social', 'Email', 'Referral', 'Direct', 'Affiliate']
  const segments = ['New', 'Growth', 'VIP', 'At Risk']

  return Array.from({ length: 72 }, (_, index) => {
    const customerId = index + 1
    const country = countries[(index + variantOffset) % countries.length]
    const city = citiesByCountry[country][(index + variantOffset) % citiesByCountry[country].length]
    const signupYear = index < 18 ? 2024 : 2025
    const signupDate = dateFromIndex(signupYear, index + 2 + variantOffset, index + 5 + variantOffset)
    const segment = segments[(index * 3 + variantOffset) % segments.length]
    const lastActiveDate = dateFromIndex(index % 5 === 0 ? 2026 : 2025, index + 7 + variantOffset, index + 11 + variantOffset)

    return {
      customer_id: customerId,
      customer_name: `Customer ${pad(customerId)}`,
      country,
      city,
      signup_date: signupDate,
      acquisition_channel: channels[(index + variantOffset) % channels.length],
      segment,
      last_active_date: lastActiveDate,
    }
  })
}

const createProducts = (variantOffset = 0): ProductRow[] => {
  const productNames = [
    'Aurora Backpack',
    'Beacon Bottle',
    'Canvas Travel Tote',
    'Drift Running Cap',
    'Echo Yoga Mat',
    'Flux Desk Lamp',
    'Glow Coffee Grinder',
    'Harbor Rain Jacket',
    'Ion Wireless Mouse',
    'Juniper Notebook',
    'Kite Packing Cubes',
    'Lumen Floor Stand',
    'Mesa Water Filter',
    'Nova Bluetooth Speaker',
    'Orbit Fitness Band',
    'Pulse Standing Desk',
    'Quartz Travel Mug',
    'Ridge Laptop Sleeve',
    'Solstice Hoodie',
    'Terra Plant Light',
    'Umbra Phone Stand',
    'Vector Cable Kit',
    'Willow Storage Bin',
    'Zenith Monitor Arm',
  ]

  return productNames.map((productName, index) => {
    const productId = index + 1
    const categoryId = ((index + variantOffset) % 6) + 1
    const price = 24 + ((index + variantOffset) % 5) * 18 + Math.floor((index + variantOffset) / 5) * 11
    const cost = Number((price * 0.47).toFixed(2))

    return {
      product_id: productId,
      product_name: productName,
      category_id: categoryId,
      price,
      cost,
      launch_date: dateFromIndex(2024, index + 1, index + 3),
      status: index % 7 === 0 ? 'Seasonal' : 'Active',
    }
  })
}

const categories = [
  [1, 'Accessories', 'Style'],
  [2, 'Home Office', 'Workspace'],
  [3, 'Outdoor', 'Lifestyle'],
  [4, 'Fitness', 'Lifestyle'],
  [5, 'Kitchen', 'Home'],
  [6, 'Tech', 'Electronics'],
] as const

const campaigns = [
  [1, 'Brand Search AU', 'Search', '2025-01-01', '2025-02-15', 5200],
  [2, 'Summer Social Launch', 'Paid Social', '2025-02-01', '2025-03-20', 7800],
  [3, 'Email Winback Q2', 'Email', '2025-04-01', '2025-05-15', 2600],
  [4, 'Affiliate Spring Push', 'Affiliate', '2025-04-10', '2025-06-01', 4300],
  [5, 'Brand Video Burst', 'Video', '2025-06-01', '2025-07-15', 9100],
  [6, 'Referral Bonus Drive', 'Referral', '2025-08-01', '2025-09-01', 1800],
  [7, 'Holiday Search Surge', 'Search', '2025-11-01', '2025-12-20', 12500],
  [8, 'Lifecycle Email Boost', 'Email', '2025-10-01', '2025-12-01', 3400],
] as const

const buildSeedSql = (variantSeed = 0) => {
  const variantOffset = normalizeVariantSeed(variantSeed)
  const customers = createCustomers(variantOffset)
  const products = createProducts(variantOffset)
  const productMap = new Map(products.map((product) => [product.product_id, product]))
  const customerMap = new Map(customers.map((customer) => [customer.customer_id, customer]))

  const orders: Array<Array<number | string | null>> = []
  const orderItems: Array<Array<number | string | null>> = []
  const payments: Array<Array<number | string | null>> = []
  const inventoryRows: Array<Array<number | string | null>> = []
  const webEvents: Array<Array<number | string | null>> = []

  let orderItemId = 1
  let paymentId = 1
  let eventId = 1

  for (let orderId = 1; orderId <= 180; orderId += 1) {
    const customerId = (((orderId * 7) + variantOffset * 5) % 60) + 1
    const customer = customerMap.get(customerId)
    const orderDate = dateFromIndex(orderId < 120 ? 2025 : 2026, orderId + 1 + variantOffset, orderId + 3 + variantOffset)
    const campaignId = (orderId + variantOffset) % 5 === 0 ? null : (((orderId + variantOffset) % campaigns.length) || campaigns.length)
    const status = (orderId + variantOffset) % 11 === 0 ? 'cancelled' : (orderId + variantOffset) % 7 === 0 ? 'processing' : 'completed'
    const deviceType = ['Desktop', 'Mobile', 'Tablet'][(orderId + variantOffset) % 3]

    orders.push([
      orderId,
      customerId,
      orderDate,
      status,
      campaignId,
      customer?.country ?? 'Australia',
      deviceType,
    ])

    const itemCount = ((orderId + variantOffset) % 3) + 1
    let orderTotal = 0

    for (let itemOffset = 0; itemOffset < itemCount; itemOffset += 1) {
      const productId = ((orderId * 5 + itemOffset * 3 + variantOffset) % products.length) + 1
      const product = productMap.get(productId)
      const quantity = ((orderId + itemOffset + variantOffset) % 4) + 1
      const discountPct = [0, 0.05, 0.1, 0.15][(orderId + itemOffset + variantOffset) % 4]
      const unitPrice = Number((product!.price * (1 + (itemOffset % 2) * 0.04)).toFixed(2))

      orderItems.push([orderItemId, orderId, productId, quantity, unitPrice, discountPct])
      orderItemId += 1

      orderTotal += quantity * unitPrice * (1 - discountPct)
    }

    const paymentStatus =
      status === 'cancelled' ? 'refunded' : (orderId + variantOffset) % 9 === 0 ? 'failed' : 'paid'
    const paymentMethod = ['Card', 'PayPal', 'Wallet'][(orderId + variantOffset) % 3]
    const paymentDate = dateFromIndex(orderId < 120 ? 2025 : 2026, orderId + 1 + variantOffset, orderId + 5 + variantOffset)

    payments.push([
      paymentId,
      orderId,
      paymentDate,
      Number(orderTotal.toFixed(2)),
      paymentMethod,
      paymentStatus,
    ])
    paymentId += 1

    const baseSession = `sess-${pad(orderId)}`
    const eventSequence =
      (orderId + variantOffset) % 6 === 0
        ? ['page_view', 'view_product', 'add_to_cart']
        : ['page_view', 'view_product', 'add_to_cart', 'purchase_intent']

    eventSequence.forEach((eventName, eventIndex) => {
      webEvents.push([
        eventId,
        customerId,
        baseSession,
        `${orderDate} ${pad(9 + eventIndex)}:00:00`,
        eventName,
        orderItems[(orderId - 1) * 2]?.[2] ?? ((((orderId * 5) + variantOffset) % products.length) + 1),
        campaignId,
        deviceType,
      ])
      eventId += 1
    })
  }

  for (let productId = 1; productId <= products.length; productId += 1) {
    inventoryRows.push([
      productId,
      16 + (((productId * 7) + variantOffset * 3) % 85),
      20 + ((productId + variantOffset) % 5) * 5,
      ['Sydney', 'Dallas', 'Berlin'][(productId + variantOffset) % 3],
      dateFromIndex(2025, productId + 2 + variantOffset, productId + 9 + variantOffset),
    ])
  }

  for (let customerId = 61; customerId <= 72; customerId += 1) {
    const customer = customerMap.get(customerId)
    for (let sessionOffset = 0; sessionOffset < 4; sessionOffset += 1) {
      const sessionId = `browse-${customerId}-${sessionOffset + 1}`
      ;['page_view', 'view_product', sessionOffset % 2 === 0 ? 'add_to_cart' : 'page_view'].forEach(
        (eventName, eventIndex) => {
          webEvents.push([
            eventId,
            customerId,
            sessionId,
            `${dateFromIndex(2025, customerId + sessionOffset, customerId + eventIndex)} ${pad(
              10 + eventIndex,
            )}:30:00`,
            eventName,
            ((customerId + sessionOffset + eventIndex + variantOffset) % products.length) + 1,
            sessionOffset % 3 === 0 ? null : (((customerId + sessionOffset + variantOffset) % campaigns.length) + 1),
            ['Desktop', 'Mobile'][(eventIndex + variantOffset) % 2],
          ])
          eventId += 1
        },
      )
    }

    if (customer) {
      customer.last_active_date = dateFromIndex(2025, customerId + 4 + variantOffset, customerId + 12 + variantOffset)
    }
  }

  return `
    PRAGMA foreign_keys = ON;

    CREATE TABLE customers (
      customer_id INTEGER PRIMARY KEY,
      customer_name TEXT NOT NULL,
      country TEXT NOT NULL,
      city TEXT NOT NULL,
      signup_date TEXT NOT NULL,
      acquisition_channel TEXT NOT NULL,
      segment TEXT NOT NULL,
      last_active_date TEXT NOT NULL
    );

    CREATE TABLE categories (
      category_id INTEGER PRIMARY KEY,
      category_name TEXT NOT NULL,
      department TEXT NOT NULL
    );

    CREATE TABLE products (
      product_id INTEGER PRIMARY KEY,
      product_name TEXT NOT NULL,
      category_id INTEGER NOT NULL,
      price REAL NOT NULL,
      cost REAL NOT NULL,
      launch_date TEXT NOT NULL,
      status TEXT NOT NULL,
      FOREIGN KEY (category_id) REFERENCES categories(category_id)
    );

    CREATE TABLE inventory (
      product_id INTEGER PRIMARY KEY,
      stock_on_hand INTEGER NOT NULL,
      reorder_point INTEGER NOT NULL,
      warehouse TEXT NOT NULL,
      last_restocked TEXT NOT NULL,
      FOREIGN KEY (product_id) REFERENCES products(product_id)
    );

    CREATE TABLE campaigns (
      campaign_id INTEGER PRIMARY KEY,
      campaign_name TEXT NOT NULL,
      channel TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      spend REAL NOT NULL
    );

    CREATE TABLE orders (
      order_id INTEGER PRIMARY KEY,
      customer_id INTEGER NOT NULL,
      order_date TEXT NOT NULL,
      status TEXT NOT NULL,
      campaign_id INTEGER,
      shipping_country TEXT NOT NULL,
      device_type TEXT NOT NULL,
      FOREIGN KEY (customer_id) REFERENCES customers(customer_id),
      FOREIGN KEY (campaign_id) REFERENCES campaigns(campaign_id)
    );

    CREATE TABLE order_items (
      order_item_id INTEGER PRIMARY KEY,
      order_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      unit_price REAL NOT NULL,
      discount_pct REAL NOT NULL,
      FOREIGN KEY (order_id) REFERENCES orders(order_id),
      FOREIGN KEY (product_id) REFERENCES products(product_id)
    );

    CREATE TABLE payments (
      payment_id INTEGER PRIMARY KEY,
      order_id INTEGER NOT NULL,
      payment_date TEXT NOT NULL,
      amount REAL NOT NULL,
      payment_method TEXT NOT NULL,
      payment_status TEXT NOT NULL,
      FOREIGN KEY (order_id) REFERENCES orders(order_id)
    );

    CREATE TABLE web_events (
      event_id INTEGER PRIMARY KEY,
      customer_id INTEGER,
      session_id TEXT NOT NULL,
      event_time TEXT NOT NULL,
      event_name TEXT NOT NULL,
      product_id INTEGER,
      campaign_id INTEGER,
      device_type TEXT NOT NULL,
      FOREIGN KEY (customer_id) REFERENCES customers(customer_id),
      FOREIGN KEY (product_id) REFERENCES products(product_id),
      FOREIGN KEY (campaign_id) REFERENCES campaigns(campaign_id)
    );

    CREATE INDEX idx_orders_customer ON orders(customer_id);
    CREATE INDEX idx_orders_campaign ON orders(campaign_id);
    CREATE INDEX idx_order_items_order ON order_items(order_id);
    CREATE INDEX idx_order_items_product ON order_items(product_id);
    CREATE INDEX idx_payments_status ON payments(payment_status);
    CREATE INDEX idx_web_events_name ON web_events(event_name);

    ${insertRows(
      'customers',
      [
        'customer_id',
        'customer_name',
        'country',
        'city',
        'signup_date',
        'acquisition_channel',
        'segment',
        'last_active_date',
      ],
      customers.map((customer) => [
        customer.customer_id,
        customer.customer_name,
        customer.country,
        customer.city,
        customer.signup_date,
        customer.acquisition_channel,
        customer.segment,
        customer.last_active_date,
      ]),
    )}

    ${insertRows('categories', ['category_id', 'category_name', 'department'], categories.map((row) => [...row]))}

    ${insertRows(
      'products',
      ['product_id', 'product_name', 'category_id', 'price', 'cost', 'launch_date', 'status'],
      products.map((product) => [
        product.product_id,
        product.product_name,
        product.category_id,
        product.price,
        product.cost,
        product.launch_date,
        product.status,
      ]),
    )}

    ${insertRows(
      'inventory',
      ['product_id', 'stock_on_hand', 'reorder_point', 'warehouse', 'last_restocked'],
      inventoryRows,
    )}

    ${insertRows(
      'campaigns',
      ['campaign_id', 'campaign_name', 'channel', 'start_date', 'end_date', 'spend'],
      campaigns.map((row) => [...row]),
    )}

    ${insertRows(
      'orders',
      ['order_id', 'customer_id', 'order_date', 'status', 'campaign_id', 'shipping_country', 'device_type'],
      orders,
    )}

    ${insertRows(
      'order_items',
      ['order_item_id', 'order_id', 'product_id', 'quantity', 'unit_price', 'discount_pct'],
      orderItems,
    )}

    ${insertRows(
      'payments',
      ['payment_id', 'order_id', 'payment_date', 'amount', 'payment_method', 'payment_status'],
      payments,
    )}

    ${insertRows(
      'web_events',
      ['event_id', 'customer_id', 'session_id', 'event_time', 'event_name', 'product_id', 'campaign_id', 'device_type'],
      webEvents,
    )}
  `
}

const rowToSerializable = (value: unknown): string | number | null => {
  if (value === null || typeof value === 'string' || typeof value === 'number') {
    return value
  }

  return String(value)
}

const convertExecResult = (db: Database, sql: string): QueryResult => {
  const execResult = db.exec(sql)

  if (execResult.length === 0) {
    return {
      columns: ['message'],
      rows: [[`Query executed successfully. Rows modified: ${db.getRowsModified()}`]],
    }
  }

  const lastResult = execResult[execResult.length - 1]
  return {
    columns: lastResult.columns,
    rows: lastResult.values.map((row: unknown[]) => row.map((value: unknown) => rowToSerializable(value))),
  }
}

export const runSqlOnVariant = async (sql: string, variantSeed = 0): Promise<QueryResult> => {
  const SQL = await getSqlModule()
  const db = new SQL.Database()

  try {
    db.exec(buildSeedSql(variantSeed))
    return convertExecResult(db, sql)
  } finally {
    db.close()
  }
}

export const runSql = async (sql: string): Promise<QueryResult> => runSqlOnVariant(sql, 0)

export const getDatabaseSnapshot = async (variantSeed = 0) => {
  const SQL = await getSqlModule()
  const db = new SQL.Database()

  try {
    db.exec(buildSeedSql(variantSeed))
    return {
      customers: convertExecResult(db, 'SELECT * FROM customers LIMIT 5;'),
      orders: convertExecResult(db, 'SELECT * FROM orders LIMIT 5;'),
      products: convertExecResult(db, 'SELECT * FROM products LIMIT 5;'),
    }
  } finally {
    db.close()
  }
}

export const getSchemaOverview = async () => {
  const SQL = await getSqlModule()
  const db = new SQL.Database()

  try {
    db.exec(buildSeedSql())

    const tables = ['customers', 'categories', 'products', 'inventory', 'campaigns', 'orders', 'order_items', 'payments', 'web_events']
    const counts = Object.fromEntries(
      tables.map((table) => {
        const result = convertExecResult(db, `SELECT COUNT(*) AS row_count FROM ${table};`)
        return [table, Number(result.rows[0]?.[0] ?? 0)]
      }),
    ) as Record<string, number>

    const samples = Object.fromEntries(
      tables.map((table) => [table, convertExecResult(db, `SELECT * FROM ${table} LIMIT 1;`)]),
    ) as Record<string, QueryResult>

    return { counts, samples }
  } finally {
    db.close()
  }
}
