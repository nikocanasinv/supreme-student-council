require("dotenv").config();

const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");
const PDFDocument = require("pdfkit");
const { Resend } = require("resend");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.join(__dirname, "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "council_inventory.db"));
db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('ADMIN','USER')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','DISABLED')),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS inventory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supply_name TEXT NOT NULL,
  category TEXT NOT NULL,
  barcode TEXT NOT NULL UNIQUE,
  quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity >= 0),
  unit TEXT NOT NULL,
  minimum_stock INTEGER NOT NULL DEFAULT 0 CHECK(minimum_stock >= 0),
  description TEXT DEFAULT '',
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inventory_id INTEGER,
  user_id INTEGER,
  transaction_type TEXT NOT NULL CHECK(transaction_type IN ('ADDED','WITHDRAWN','ADJUSTED','EDITED','DEACTIVATED')),
  quantity INTEGER NOT NULL DEFAULT 0,
  previous_quantity INTEGER NOT NULL,
  new_quantity INTEGER NOT NULL,
  barcode TEXT NOT NULL,
  remarks TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY(inventory_id) REFERENCES inventory(id) ON DELETE SET NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  message TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- One physical barcode per unit/piece of a supply.
-- This table is additive so existing inventory records remain compatible.
CREATE TABLE IF NOT EXISTS inventory_barcodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inventory_id INTEGER NOT NULL,
  barcode TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK(status IN ('AVAILABLE','WITHDRAWN')),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  withdrawn_at TEXT,
  withdrawn_by INTEGER,
  FOREIGN KEY(inventory_id) REFERENCES inventory(id) ON DELETE CASCADE,
  FOREIGN KEY(withdrawn_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_inventory_barcode ON inventory(barcode);
CREATE INDEX IF NOT EXISTS idx_inventory_barcodes_inventory ON inventory_barcodes(inventory_id);
CREATE INDEX IF NOT EXISTS idx_inventory_barcodes_status ON inventory_barcodes(status);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_transactions_inventory ON transactions(inventory_id);
`);

const defaultPassword = process.env.ADMIN_DEFAULT_PASSWORD || "Admin@12345";
const adminNames = ["JJ", "Judiel", "Sir Ey", "Niko"];

function getReportRows() {
  return db.prepare(`
    SELECT t.created_at AS "Date/Time",
           COALESCE(u.full_name,'System') AS "User",
           COALESCE(i.supply_name,'Deactivated Supply') AS "Supply",
           t.barcode AS "Barcode",
           t.transaction_type AS "Action",
           t.quantity AS "Quantity Change",
           t.previous_quantity AS "Previous Stock",
           t.new_quantity AS "New Stock",
           t.remarks AS "Remarks"
    FROM transactions t
    LEFT JOIN inventory i ON i.id=t.inventory_id
    LEFT JOIN users u ON u.id=t.user_id
    ORDER BY t.created_at ASC, t.id ASC
  `).all();
}

function buildReportCsv(rows) {
  const headers = ["Date/Time","User","Supply","Barcode","Action","Quantity Change","Previous Stock","New Stock","Remarks"];
  const esc = v => `"${String(v ?? "").replace(/"/g,'""')}"`;
  return [headers.map(esc).join(",")]
    .concat(rows.map(r => headers.map(h => esc(r[h])).join(","))).join("\r\n");
}

function createReportPdf(rows) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 32, bufferPages: true });
    const chunks = [];
    doc.on("data", chunk => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const headers = ["Date/Time","User","Supply","Barcode","Action","Change","Previous","New","Remarks"];
    const widths = [82, 72, 90, 72, 62, 50, 52, 42, 200];
    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const totalWidth = widths.reduce((a,b)=>a+b,0);
    const scale = Math.min(1, pageWidth / totalWidth);
    const w = widths.map(x => x * scale);
    const startX = doc.page.margins.left;
    let y = 32;

    doc.fontSize(18).font("Helvetica-Bold").text("Council Inventory Transaction Report", startX, y);
    y += 24;
    doc.fontSize(9).font("Helvetica").fillColor("#555555")
      .text(`Generated: ${new Date().toLocaleString("en-PH")}  |  Total transactions: ${rows.length}`, startX, y);
    y += 20;

    function drawHeader() {
      doc.fontSize(7).font("Helvetica-Bold").fillColor("#111111");
      let x = startX;
      for (let i=0;i<headers.length;i++) {
        doc.rect(x, y, w[i], 20).stroke();
        doc.text(headers[i], x+3, y+6, { width:w[i]-6, height:14, ellipsis:true });
        x += w[i];
      }
      y += 20;
    }

    function rowHeight(values) {
      doc.fontSize(6.5).font("Helvetica");
      return Math.max(18, ...values.map((v,i) => doc.heightOfString(String(v ?? ""), { width:w[i]-6, lineGap:1 }))) + 6;
    }

    drawHeader();
    rows.forEach((r, idx) => {
      const values = [r["Date/Time"], r.User, r.Supply, r.Barcode, r.Action, r["Quantity Change"], r["Previous Stock"], r["New Stock"], r.Remarks];
      const h = rowHeight(values);
      if (y + h > doc.page.height - 34) {
        doc.addPage();
        y = 32;
        doc.fontSize(10).font("Helvetica-Bold").text("Council Inventory Transaction Report — continued", startX, y);
        y += 18;
        drawHeader();
      }
      let x = startX;
      doc.fontSize(6.5).font("Helvetica").fillColor("#111111");
      for (let i=0;i<values.length;i++) {
        doc.rect(x, y, w[i], h).stroke();
        doc.text(String(values[i] ?? ""), x+3, y+4, { width:w[i]-6, height:h-7, ellipsis:true, lineGap:1 });
        x += w[i];
      }
      y += h;
    });

    doc.end();
  });
}

const insertUser = db.prepare(`
  INSERT INTO users (full_name, username, password_hash, role)
  VALUES (?, ?, ?, ?)
`);

const seed = db.transaction(() => {
  for (const name of adminNames) {
    const exists = db.prepare("SELECT id FROM users WHERE username = ?").get(name);
    if (!exists) {
      insertUser.run(name, name, bcrypt.hashSync(defaultPassword, 12), "ADMIN");
    }
  }
});
seed();

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://unpkg.com"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'"],
      mediaSrc: ["'self'", "blob:"]
    }
  }
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set("trust proxy", 1);

app.use(session({
  secret: process.env.SESSION_SECRET || "CHANGE_ME_IN_ENV",
  resave: false,
  saveUninitialized: false,
  proxy: true,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    maxAge: 8 * 60 * 60 * 1000
  }
}));

app.use(express.static(path.join(__dirname, "public")));

function auth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Authentication required." });
  next();
}

function adminOnly(req, res, next) {
  if (!req.session.user || req.session.user.role !== "ADMIN") {
    return res.status(403).json({ error: "Admin access required." });
  }
  next();
}

function cleanInt(value, fallback = 0) {
  const n = Number(value);
  return Number.isInteger(n) ? n : fallback;
}

function requireFields(body, fields) {
  return fields.filter(f => body[f] === undefined || body[f] === null || String(body[f]).trim() === "");
}

function notifyAdmins(message) {
  const admins = db.prepare("SELECT id FROM users WHERE role='ADMIN' AND status='ACTIVE'").all();
  const stmt = db.prepare("INSERT INTO notifications (user_id, message) VALUES (?, ?)");
  const tx = db.transaction(() => admins.forEach(a => stmt.run(a.id, message)));
  tx();
}

app.get("/api/me", (req, res) => {
  res.json({ user: req.session.user || null });
});

app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Username and password are required." });

  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(String(username).trim());
  if (!user || user.status !== "ACTIVE" || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: "Invalid username or password." });
  }

  req.session.user = {
    id: user.id,
    full_name: user.full_name,
    username: user.username,
    role: user.role
  };

  res.json({ user: req.session.user });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

app.get("/api/dashboard", auth, (req, res) => {
  const totalSupplies = db.prepare("SELECT COUNT(*) AS n FROM inventory").get().n;
  const totalQuantity = db.prepare("SELECT COALESCE(SUM(quantity),0) AS n FROM inventory").get().n;
  const released = db.prepare("SELECT COALESCE(SUM(quantity),0) AS n FROM transactions WHERE transaction_type='WITHDRAWN'").get().n;
  const lowStock = db.prepare("SELECT COUNT(*) AS n FROM inventory WHERE quantity > 0 AND quantity <= minimum_stock").get().n;
  const outOfStock = db.prepare("SELECT COUNT(*) AS n FROM inventory WHERE quantity = 0").get().n;
  const totalTransactions = db.prepare("SELECT COUNT(*) AS n FROM transactions").get().n;

  const lowItems = db.prepare(`
    SELECT id, supply_name, barcode, quantity, unit, minimum_stock,
      CASE WHEN quantity=0 THEN 'OUT OF STOCK'
           WHEN quantity <= minimum_stock THEN 'LOW STOCK'
           ELSE 'AVAILABLE' END AS status
    FROM inventory
    WHERE quantity <= minimum_stock
    ORDER BY quantity ASC, supply_name ASC
    LIMIT 10
  `).all();

  res.json({
    totalSupplies, totalQuantity, released, lowStock, outOfStock, totalTransactions, lowItems
  });
});

app.get("/api/inventory", auth, (req, res) => {
  const search = String(req.query.search || "").trim();
  const category = String(req.query.category || "").trim();
  let sql = `
    SELECT i.*,
      CASE WHEN i.quantity=0 THEN 'OUT OF STOCK'
           WHEN i.quantity <= i.minimum_stock THEN 'LOW STOCK'
           ELSE 'AVAILABLE' END AS status,
      u.full_name AS created_by_name,
      (SELECT COUNT(*) FROM inventory_barcodes ib WHERE ib.inventory_id=i.id) AS barcode_count,
      (SELECT COUNT(*) FROM inventory_barcodes ib WHERE ib.inventory_id=i.id AND ib.status='AVAILABLE') AS available_barcode_count
    FROM inventory i
    LEFT JOIN users u ON u.id=i.created_by
    WHERE 1=1
  `;
  const params = [];
  if (search) {
    sql += " AND (i.supply_name LIKE ? OR i.barcode LIKE ? OR i.category LIKE ?)";
    const s = `%${search}%`;
    params.push(s, s, s);
  }
  if (category) {
    sql += " AND i.category = ?";
    params.push(category);
  }
  sql += " ORDER BY i.supply_name ASC";
  res.json({ items: db.prepare(sql).all(...params) });
});

app.get("/api/categories", auth, (req, res) => {
  res.json(db.prepare("SELECT DISTINCT category FROM inventory ORDER BY category").all().map(x => x.category));
});

app.post("/api/inventory", adminOnly, (req, res) => {
  const missing = requireFields(req.body, ["supply_name","category","quantity","unit","minimum_stock"]);
  if (missing.length) return res.status(400).json({ error: `Missing: ${missing.join(", ")}` });

  const quantity = cleanInt(req.body.quantity, -1);
  const minimum = cleanInt(req.body.minimum_stock, -1);
  if (quantity < 0 || minimum < 0) {
    return res.status(400).json({ error: "Quantity and minimum stock must be non-negative whole numbers." });
  }

  let barcodes = Array.isArray(req.body.barcodes)
    ? req.body.barcodes.map(x => String(x ?? "").trim()).filter(Boolean)
    : [];

  // Every physical unit gets its own barcode when stock is itemized.
  if (quantity > 0 && barcodes.length !== quantity) {
    return res.status(400).json({ error: `Enter exactly ${quantity} unique barcode(s), one for each ${String(req.body.unit).trim() || "unit"}.` });
  }

  if (new Set(barcodes.map(x => x.toLowerCase())).size !== barcodes.length) {
    return res.status(400).json({ error: "Barcode values must be unique." });
  }

  // Keep the legacy inventory barcode column populated with the first item barcode.
  // The new inventory_barcodes table is the authoritative list for itemized stock.
  const masterBarcode = barcodes[0] || String(req.body.barcode || "").trim();
  if (!masterBarcode && quantity > 0) {
    return res.status(400).json({ error: "At least one barcode is required." });
  }

  try {
    const result = db.transaction(() => {
      const info = db.prepare(`
        INSERT INTO inventory
        (supply_name, category, barcode, quantity, unit, minimum_stock, description, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        String(req.body.supply_name).trim(),
        String(req.body.category).trim(),
        masterBarcode || `UNBARCODED-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
        quantity,
        String(req.body.unit).trim(),
        minimum,
        String(req.body.description || "").trim(),
        req.session.user.id
      );

      const addBarcode = db.prepare(`
        INSERT INTO inventory_barcodes (inventory_id, barcode)
        VALUES (?, ?)
      `);
      for (const code of barcodes) addBarcode.run(info.lastInsertRowid, code);

      db.prepare(`
        INSERT INTO transactions
        (inventory_id,user_id,transaction_type,quantity,previous_quantity,new_quantity,barcode,remarks)
        VALUES (?,?,?,?,?,?,?,?)
      `).run(
        info.lastInsertRowid, req.session.user.id, "ADDED", quantity, 0, quantity,
        masterBarcode || "",
        barcodes.length ? `New supply added with ${barcodes.length} individual barcode(s)` : "New supply added"
      );

      return info.lastInsertRowid;
    })();

    res.status(201).json({ success: true, id: result });
  } catch (e) {
    if (String(e.message).includes("UNIQUE")) {
      return res.status(409).json({ error: "One of the barcode values is already registered." });
    }
    res.status(500).json({ error: "Unable to add supply." });
  }
});

app.put("/api/inventory/:id", adminOnly, (req, res) => {
  const id = Number(req.params.id);
  const old = db.prepare("SELECT * FROM inventory WHERE id=?").get(id);
  if (!old) return res.status(404).json({ error: "Supply not found." });

  const quantity = cleanInt(req.body.quantity, -1);
  const minimum = cleanInt(req.body.minimum_stock, -1);
  if (quantity < 0 || minimum < 0) {
    return res.status(400).json({ error: "Quantity and minimum stock must be non-negative whole numbers." });
  }

  try {
    db.transaction(() => {
      const itemizedCount = db.prepare(
        "SELECT COUNT(*) AS n FROM inventory_barcodes WHERE inventory_id=?"
      ).get(id).n;

      if (itemizedCount > 0) {
        const availableCount = db.prepare(
          "SELECT COUNT(*) AS n FROM inventory_barcodes WHERE inventory_id=? AND status='AVAILABLE'"
        ).get(id).n;

        if (quantity !== old.quantity) {
          if (quantity !== availableCount + db.prepare(
            "SELECT COUNT(*) AS n FROM inventory_barcodes WHERE inventory_id=? AND status='WITHDRAWN'"
          ).get(id).n) {
            throw new Error("ITEMIZED_QUANTITY_MISMATCH");
          }
          // Itemized stock quantity is derived from physical barcode records.
          // Changing quantity directly would desynchronize stock from the labels.
          throw new Error("ITEMIZED_USE_BARCODES");
        }
      }

      const barcode = String(req.body.barcode || old.barcode).trim();
      db.prepare(`
        UPDATE inventory
        SET supply_name=?, category=?, barcode=?, quantity=?, unit=?, minimum_stock=?, description=?, updated_at=datetime('now','localtime')
        WHERE id=?
      `).run(
        String(req.body.supply_name).trim(),
        String(req.body.category).trim(),
        barcode,
        quantity,
        String(req.body.unit).trim(),
        minimum,
        String(req.body.description || "").trim(),
        id
      );

      const type = quantity !== old.quantity ? "ADJUSTED" : "EDITED";
      const delta = quantity - old.quantity;
      db.prepare(`
        INSERT INTO transactions
        (inventory_id,user_id,transaction_type,quantity,previous_quantity,new_quantity,barcode,remarks)
        VALUES (?,?,?,?,?,?,?,?)
      `).run(
        id, req.session.user.id, type, delta, old.quantity, quantity,
        barcode,
        quantity !== old.quantity ? "Admin inventory adjustment" : "Inventory information edited"
      );
    })();
    res.json({ success: true });
  } catch (e) {
    if (e.message === "ITEMIZED_USE_BARCODES") {
      return res.status(400).json({ error: "This supply uses individual barcodes. Add or remove physical barcode records instead of changing Quantity directly." });
    }
    if (String(e.message).includes("UNIQUE")) return res.status(409).json({ error: "Barcode already registered." });
    res.status(500).json({ error: "Unable to update supply." });
  }
});


app.get("/api/inventory/:id/barcodes", adminOnly, (req, res) => {
  const id = Number(req.params.id);
  const item = db.prepare("SELECT id, supply_name, quantity, unit FROM inventory WHERE id=?").get(id);
  if (!item) return res.status(404).json({ error: "Supply not found." });

  const barcodes = db.prepare(`
    SELECT id, barcode, status, created_at, withdrawn_at
    FROM inventory_barcodes
    WHERE inventory_id=?
    ORDER BY id ASC
  `).all(id);

  res.json({
    inventory: item,
    barcodes,
    counts: {
      total: barcodes.length,
      available: barcodes.filter(x => x.status === "AVAILABLE").length,
      withdrawn: barcodes.filter(x => x.status === "WITHDRAWN").length
    }
  });
});

app.post("/api/inventory/:id/barcodes", adminOnly, (req, res) => {
  const id = Number(req.params.id);
  const item = db.prepare("SELECT * FROM inventory WHERE id=?").get(id);
  if (!item) return res.status(404).json({ error: "Supply not found." });

  const barcodes = Array.isArray(req.body.barcodes)
    ? req.body.barcodes.map(x => String(x ?? "").trim()).filter(Boolean)
    : [];

  if (!barcodes.length) return res.status(400).json({ error: "Enter at least one barcode." });
  if (new Set(barcodes.map(x => x.toLowerCase())).size !== barcodes.length) {
    return res.status(400).json({ error: "Barcode values must be unique." });
  }

  const existing = db.prepare(`
    SELECT barcode FROM inventory_barcodes
    WHERE inventory_id=?
  `).all(id).map(x => String(x.barcode).toLowerCase());

  const allExisting = db.prepare("SELECT barcode FROM inventory_barcodes").all().map(x => String(x.barcode).toLowerCase());
  const conflicts = barcodes.filter(x => allExisting.includes(x.toLowerCase()));
  if (conflicts.length) {
    return res.status(409).json({ error: `Barcode already registered: ${conflicts[0]}` });
  }

  try {
    db.transaction(() => {
      const add = db.prepare("INSERT INTO inventory_barcodes (inventory_id, barcode) VALUES (?, ?)");
      const oldCount = existing.length;

      // A legacy supply already has a quantity in stock. Require all current
      // pieces to receive labels before switching that supply to itemized mode.
      if (oldCount === 0) {
        if (barcodes.length !== item.quantity) {
          throw new Error("LEGACY_BARCODE_COUNT");
        }
      }

      barcodes.forEach(code => add.run(id, code));

      // Once a supply is itemized, adding barcode records means adding new
      // physical stock, so the inventory quantity increases by the same amount.
      if (oldCount > 0) {
        db.prepare(`
          UPDATE inventory
          SET quantity=quantity+?, updated_at=datetime('now','localtime')
          WHERE id=?
        `).run(barcodes.length, id);
      }

      const newQty = oldCount > 0 ? item.quantity + barcodes.length : item.quantity;
      db.prepare(`
        UPDATE inventory SET barcode=?, updated_at=datetime('now','localtime') WHERE id=?
      `).run(item.barcode || barcodes[0], id);

      db.prepare(`
        INSERT INTO transactions
        (inventory_id,user_id,transaction_type,quantity,previous_quantity,new_quantity,barcode,remarks)
        VALUES (?,?,?,?,?,?,?,?)
      `).run(
        id, req.session.user.id, "ADJUSTED",
        oldCount > 0 ? barcodes.length : 0,
        item.quantity, newQty,
        barcodes[0],
        oldCount > 0
          ? `Added ${barcodes.length} new individual barcode(s)`
          : `Assigned ${barcodes.length} individual barcode(s) to existing stock`
      );
    })();

    res.status(201).json({ success: true, added: barcodes.length });
  } catch (e) {
    if (e.message === "LEGACY_BARCODE_COUNT") {
      return res.status(400).json({ error: `This supply currently has ${item.quantity} ${item.unit} in stock. Enter exactly ${item.quantity} individual barcode(s) before using itemized scanning.` });
    }
    if (String(e.message).includes("UNIQUE")) {
      return res.status(409).json({ error: "One of the barcode values is already registered." });
    }
    res.status(500).json({ error: "Unable to save barcodes." });
  }
});

app.delete("/api/inventory/:id/barcodes/:barcodeId", adminOnly, (req, res) => {
  const id = Number(req.params.id);
  const barcodeId = Number(req.params.barcodeId);
  const item = db.prepare("SELECT * FROM inventory_barcodes WHERE id=? AND inventory_id=?").get(barcodeId, id);
  if (!item) return res.status(404).json({ error: "Barcode not found." });
  if (item.status !== "AVAILABLE") {
    return res.status(400).json({ error: "A withdrawn barcode cannot be removed." });
  }

  const supply = db.prepare("SELECT * FROM inventory WHERE id=?").get(id);
  if (!supply) return res.status(404).json({ error: "Supply not found." });

  const totalCount = db.prepare("SELECT COUNT(*) AS n FROM inventory_barcodes WHERE inventory_id=?").get(id).n;
  if (totalCount <= 1) {
    return res.status(400).json({ error: "Keep at least one barcode record for an itemized supply." });
  }
  if (supply.quantity <= 0) {
    return res.status(400).json({ error: "Stock is already zero." });
  }

  db.transaction(() => {
    db.prepare("DELETE FROM inventory_barcodes WHERE id=?").run(barcodeId);
    db.prepare("UPDATE inventory SET quantity=quantity-1, updated_at=datetime('now','localtime') WHERE id=? AND quantity>0").run(id);
    db.prepare(`
      INSERT INTO transactions
      (inventory_id,user_id,transaction_type,quantity,previous_quantity,new_quantity,barcode,remarks)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(
      id, req.session.user.id, "ADJUSTED", -1, supply.quantity, supply.quantity - 1,
      item.barcode, "Removed available individual barcode"
    );
  })();

  res.json({ success: true });
});

app.delete("/api/inventory/:id", adminOnly, (req, res) => {
  const id = Number(req.params.id);
  const item = db.prepare("SELECT * FROM inventory WHERE id=?").get(id);
  if (!item) return res.status(404).json({ error: "Supply not found." });

  db.transaction(() => {
    db.prepare("DELETE FROM inventory WHERE id=?").run(id);
    db.prepare(`
      INSERT INTO transactions
      (inventory_id,user_id,transaction_type,quantity,previous_quantity,new_quantity,barcode,remarks)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(null, req.session.user.id, "DEACTIVATED", 0, item.quantity, item.quantity,
           item.barcode, `Supply deactivated: ${item.supply_name}`);
  })();

  res.json({ success: true });
});

app.get("/api/transactions", adminOnly, (req, res) => {
  const { search="", type="", user="", from="", to="" } = req.query;
  let sql = `
    SELECT t.*, i.supply_name, u.full_name AS user_name
    FROM transactions t
    LEFT JOIN inventory i ON i.id=t.inventory_id
    LEFT JOIN users u ON u.id=t.user_id
    WHERE 1=1
  `;
  const p = [];
  if (search) {
    sql += " AND (t.barcode LIKE ? OR i.supply_name LIKE ? OR u.full_name LIKE ? OR t.remarks LIKE ?)";
    const s = `%${search}%`; p.push(s,s,s,s);
  }
  if (type) { sql += " AND t.transaction_type=?"; p.push(type); }
  if (user) { sql += " AND u.id=?"; p.push(Number(user)); }
  if (from) { sql += " AND date(t.created_at) >= date(?)"; p.push(from); }
  if (to) { sql += " AND date(t.created_at) <= date(?)"; p.push(to); }
  sql += " ORDER BY t.created_at DESC, t.id DESC";
  res.json({ transactions: db.prepare(sql).all(...p) });
});

app.delete("/api/transactions", adminOnly, (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : [];
    const result = db.transaction(() => {
      if (ids.length) {
        const placeholders = ids.map(() => "?").join(",");
        return db.prepare(`DELETE FROM transactions WHERE id IN (${placeholders})`).run(...ids);
      }
      return db.prepare("DELETE FROM transactions").run();
    })();
    res.json({ success: true, deleted: result.changes });
  } catch (e) {
    console.error("DELETE TRANSACTION HISTORY ERROR:", e);
    res.status(500).json({ error: "Unable to delete transaction history." });
  }
});

app.post("/api/withdraw", auth, (req, res) => {
  const { inventory_id, barcode, barcodes, quantity } = req.body;
  const qty = cleanInt(quantity, 0);
  if (!inventory_id || qty <= 0) {
    return res.status(400).json({ error: "Supply and a positive quantity are required." });
  }

  const requestedBarcodes = Array.isArray(barcodes)
    ? barcodes.map(x => String(x ?? "").trim()).filter(Boolean)
    : (barcode ? [String(barcode).trim()] : []);

  try {
    const result = db.transaction(() => {
      const item = db.prepare("SELECT * FROM inventory WHERE id=?").get(Number(inventory_id));
      if (!item) throw new Error("NOT_FOUND");

      const itemizedCount = db.prepare(
        "SELECT COUNT(*) AS n FROM inventory_barcodes WHERE inventory_id=?"
      ).get(item.id).n;

      if (itemizedCount > 0) {
        if (requestedBarcodes.length !== qty) throw new Error("BARCODE_COUNT_MISMATCH");
        if (new Set(requestedBarcodes.map(x => x.toLowerCase())).size !== requestedBarcodes.length) {
          throw new Error("DUPLICATE_BARCODE");
        }

        const placeholders = requestedBarcodes.map(() => "?").join(",");
        const rows = db.prepare(`
          SELECT * FROM inventory_barcodes
          WHERE inventory_id=? AND barcode IN (${placeholders})
        `).all(item.id, ...requestedBarcodes);

        if (rows.length !== requestedBarcodes.length) throw new Error("BARCODE_MISMATCH");
        if (rows.some(x => x.status !== "AVAILABLE")) throw new Error("BARCODE_USED");
        if (item.quantity < qty) throw new Error("INSUFFICIENT");

        const now = new Date().toISOString();
        const mark = db.prepare(`
          UPDATE inventory_barcodes
          SET status='WITHDRAWN', withdrawn_at=?, withdrawn_by=?
          WHERE id=? AND status='AVAILABLE'
        `);
        for (const row of rows) {
          const changed = mark.run(now, req.session.user.id, row.id);
          if (changed.changes !== 1) throw new Error("BARCODE_USED");
        }

        const updated = db.prepare(`
          UPDATE inventory
          SET quantity=quantity-?, updated_at=datetime('now','localtime')
          WHERE id=? AND quantity>=?
        `).run(qty, item.id, qty);

        if (updated.changes !== 1) throw new Error("INSUFFICIENT");

        const newQty = item.quantity - qty;
        const tx = db.prepare(`
          INSERT INTO transactions
          (inventory_id,user_id,transaction_type,quantity,previous_quantity,new_quantity,barcode,remarks)
          VALUES (?,?,?,?,?,?,?,?)
        `).run(
          item.id, req.session.user.id, "WITHDRAWN", -qty, item.quantity, newQty,
          requestedBarcodes.join(", "),
          "Supply withdrawn after individual barcode verification"
        );

        return {
          item, newQty, txId: tx.lastInsertRowid,
          barcodes: requestedBarcodes
        };
      }

      // Backward-compatible behavior for older supplies that still have one
      // supply-level barcode and have not yet been itemized.
      if (!barcode || String(item.barcode) !== String(barcode).trim()) throw new Error("BARCODE_MISMATCH");
      if (item.quantity < qty) throw new Error("INSUFFICIENT");

      const updated = db.prepare(`
        UPDATE inventory
        SET quantity=quantity-?, updated_at=datetime('now','localtime')
        WHERE id=? AND quantity>=?
      `).run(qty, item.id, qty);

      if (updated.changes !== 1) throw new Error("INSUFFICIENT");

      const newQty = item.quantity - qty;
      const tx = db.prepare(`
        INSERT INTO transactions
        (inventory_id,user_id,transaction_type,quantity,previous_quantity,new_quantity,barcode,remarks)
        VALUES (?,?,?,?,?,?,?,?)
      `).run(
        item.id, req.session.user.id, "WITHDRAWN", -qty, item.quantity, newQty,
        item.barcode, "Supply withdrawn after barcode verification"
      );

      return { item, newQty, txId: tx.lastInsertRowid, barcodes: [item.barcode] };
    })();

    notifyAdmins(
      `${req.session.user.full_name} withdrew ${qty} ${result.item.unit} of ${result.item.supply_name}. Remaining: ${result.newQty}.`
    );

    res.json({
      success: true,
      receipt: {
        transaction_id: result.txId,
        user: req.session.user.full_name,
        supply: result.item.supply_name,
        quantity: qty,
        unit: result.item.unit,
        barcode: result.barcodes.join(", "),
        remaining: result.newQty,
        date_time: new Date().toLocaleString("en-PH")
      }
    });
  } catch (e) {
    if (e.message === "NOT_FOUND") return res.status(404).json({ error: "Supply not found." });
    if (e.message === "BARCODE_COUNT_MISMATCH") return res.status(400).json({ error: `Please scan exactly ${qty} individual barcode(s).` });
    if (e.message === "DUPLICATE_BARCODE") return res.status(400).json({ error: "The same barcode cannot be scanned twice in one withdrawal." });
    if (e.message === "BARCODE_MISMATCH") return res.status(400).json({ error: "Barcode does not belong to the selected supply." });
    if (e.message === "BARCODE_USED") return res.status(409).json({ error: "One of the scanned barcodes has already been withdrawn." });
    if (e.message === "INSUFFICIENT") return res.status(409).json({ error: "Insufficient stock. The quantity cannot become negative." });
    res.status(500).json({ error: "Withdrawal failed." });
  }
});

app.get("/api/my-transactions", auth, (req, res) => {
  res.json({
    transactions: db.prepare(`
      SELECT t.*, i.supply_name
      FROM transactions t
      LEFT JOIN inventory i ON i.id=t.inventory_id
      WHERE t.user_id=?
      ORDER BY t.created_at DESC, t.id DESC
    `).all(req.session.user.id)
  });
});

app.get("/api/users", adminOnly, (req, res) => {
  res.json({
    users: db.prepare(`
      SELECT id, full_name, username, role, status, created_at, updated_at
      FROM users ORDER BY role DESC, full_name ASC
    `).all()
  });
});

app.post("/api/users", adminOnly, (req, res) => {
  const missing = requireFields(req.body, ["full_name","username","password","role"]);
  if (missing.length) return res.status(400).json({ error: `Missing: ${missing.join(", ")}` });
  if (!["ADMIN","USER"].includes(req.body.role)) return res.status(400).json({ error: "Invalid role." });
  if (String(req.body.password).length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });

  try {
    db.prepare(`
      INSERT INTO users (full_name, username, password_hash, role)
      VALUES (?,?,?,?)
    `).run(
      String(req.body.full_name).trim(),
      String(req.body.username).trim(),
      bcrypt.hashSync(String(req.body.password), 12),
      req.body.role
    );
    res.status(201).json({ success: true });
  } catch (e) {
    if (String(e.message).includes("UNIQUE")) return res.status(409).json({ error: "Username already exists." });
    res.status(500).json({ error: "Unable to create user." });
  }
});

app.put("/api/users/:id", adminOnly, (req, res) => {
  const id = Number(req.params.id);
  const target = db.prepare("SELECT * FROM users WHERE id=?").get(id);
  if (!target) return res.status(404).json({ error: "User not found." });

  const fullName = String(req.body.full_name || target.full_name).trim();
  const role = req.body.role || target.role;
  const status = req.body.status || target.status;
  const password = req.body.password ? String(req.body.password) : null;

  if (!["ADMIN","USER"].includes(role) || !["ACTIVE","DISABLED"].includes(status)) return res.status(400).json({ error: "Invalid role or status." });
  if (password && password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });

  const activeAdminCount = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='ADMIN' AND status='ACTIVE'").get().n;
  if (target.role === "ADMIN" && target.status === "ACTIVE" &&
      (role !== "ADMIN" || status !== "ACTIVE") && activeAdminCount <= 1) {
    return res.status(400).json({ error: "At least one active Admin account must remain." });
  }

  db.prepare(`
    UPDATE users SET full_name=?, role=?, status=?, updated_at=datetime('now','localtime'),
      password_hash=COALESCE(?, password_hash)
    WHERE id=?
  `).run(fullName, role, status, password ? bcrypt.hashSync(password, 12) : null, id);

  res.json({ success: true });
});

app.get("/api/notifications", adminOnly, (req, res) => {
  res.json({
    notifications: db.prepare(`
      SELECT n.*, u.full_name AS recipient
      FROM notifications n
      LEFT JOIN users u ON u.id=n.user_id
      ORDER BY n.created_at DESC LIMIT 100
    `).all()
  });
});

app.post("/api/notifications/read", adminOnly, (req, res) => {
  db.prepare("UPDATE notifications SET is_read=1 WHERE user_id=?").run(req.session.user.id);
  res.json({ success: true });
});

app.get("/api/export.csv", adminOnly, (req, res) => {
  const rows = getReportRows();
  const csv = buildReportCsv(rows);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="Council_Inventory_Record_${new Date().toISOString().slice(0,10)}.csv"`);
  res.send("\uFEFF" + csv);
});

app.get("/api/export.pdf", adminOnly, async (req, res) => {
  try {
    const pdf = await createReportPdf(getReportRows());
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="Council_Inventory_Report_${new Date().toISOString().slice(0,10)}.pdf"`);
    res.send(pdf);
  } catch (e) {
    console.error("PDF REPORT ERROR:", e);
    res.status(500).json({ error: "Unable to generate the PDF report." });
  }
});

app.post("/api/export.pdf-email", adminOnly, async (req, res) => {
  const rows = getReportRows();
  const rawRecipient = String(req.body?.to || "").trim();
  const recipients = rawRecipient.split(/[,;]+/).map(x => x.trim()).filter(Boolean);
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!recipients.length || recipients.some(x => !emailPattern.test(x))) {
    return res.status(400).json({ error: "Enter at least one valid email address." });
  }
  try {
    const pdf = await createReportPdf(rows);
    const csv = buildReportCsv(rows);
    const filename = `Council_Inventory_Report_${new Date().toISOString().slice(0,10)}.pdf`;
    const resend = new Resend(process.env.RESEND_API_KEY);

    if (!process.env.RESEND_API_KEY) {
      return res.status(503).json({
        error: "Email sending is not configured. Add RESEND_API_KEY in Render Environment Variables."
      });
    }

    await resend.emails.send({
      from: process.env.RESEND_FROM,
      to: recipients,
      subject: `Council Inventory Report - ${new Date().toLocaleDateString("en-PH")}`,
      text: `Attached is the Council Inventory Report generated by ${req.session.user.full_name}.`,
      attachments: [
        {
          filename,
          content: pdf.toString("base64")
        },
        {
          filename: filename.replace(/\.pdf$/i, ".csv"),
          content: Buffer.from("\uFEFF" + csv, "utf8").toString("base64")
        }
      ]
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("X-Report-Email", "sent");
    res.setHeader("X-Report-Recipient", recipients.join(", "));
    res.send(pdf);
  } catch (e) {
    console.error("REPORT EMAIL ERROR:", e);
    res.status(500).json({ error: "Unable to generate or email the PDF report. Check your SMTP settings and recipient address." });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Council Inventory System running at http://localhost:${PORT}`);
  console.log("Default Admin usernames: JJ, Judiel, Sir Ey, Niko");
  console.log(`Default Admin password: ${defaultPassword}`);
});
