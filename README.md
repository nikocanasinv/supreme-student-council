# Council Office Inventory Management System

A real shared-database inventory system for the Council Office.

## Fixed roles

### Admin
- JJ
- Judiel
- Sir Ey
- Niko

### User
Other Council members are regular USER accounts created by an Admin.

## Features

- Secure session login
- Role-based Admin/User access
- Password hashing with bcrypt
- SQLite shared database
- Add/edit/adjust/deactivate inventory
- Unique barcode validation
- Individual barcode labels for every physical piece of a supply
- Live barcode image preview and print-ready barcode labels for Admins
- Mobile/browser camera barcode scanning using ZXing
- Supply selection + quantity + barcode verification
- Atomic inventory deduction (never negative)
- Complete transaction/audit history
- Previous stock and new stock tracking
- User management
- Low-stock and out-of-stock status
- Admin notifications
- CSV export of the transaction record
- Print-friendly pages
- Responsive mobile layout

## Windows setup using Sublime Text

### 1. Install Node.js

Install the current LTS version of Node.js.

Then open Command Prompt and check:

```text
node -v
npm -v
```

### 2. Open the project

Extract the project folder and open it in Sublime Text.

Open a Command Prompt in the project folder.

### 3. Create the environment file

Copy `.env.example` to `.env`.

For example:

```text
PORT=3000
SESSION_SECRET=replace-this-with-a-long-random-secret
ADMIN_DEFAULT_PASSWORD=Admin@12345
NODE_ENV=development
```

You should change both the session secret and default password before real deployment.

### 4. Install dependencies

```text
npm install
```

### 5. Start the system

```text
npm start
```

Open:

```text
http://localhost:3000
```

### 6. Initial Admin accounts

The first time the server runs, these Admin usernames are automatically created:

- JJ
- Judiel
- Sir Ey
- Niko

They all use the value in `ADMIN_DEFAULT_PASSWORD`.

Default for this project:

```text
Admin@12345
```

Create individual passwords for actual users through User Management. For production, change the Admin passwords as well.

## Individual barcode labels

Admins can create an individual barcode for every physical piece when registering a new supply.

Example:

- Glue Stick — Piece #1 — `12345`
- Glue Stick — Piece #2 — `12346`
- Glue Stick — Piece #3 — `12347`

The Admin page displays the corresponding Code 128 barcode image as the code is entered. Barcodes can be printed individually or as a set of available labels.

For existing supplies that were created before individual barcode mode was added, open:

```text
Admin → Inventory → Barcodes
```

and assign exactly one unique barcode to each piece currently in stock.

Once a supply is itemized, withdrawing multiple pieces requires scanning one physical barcode per piece. A barcode marked as withdrawn cannot be reused.

## Barcode scanning requirements

The scanner uses the browser camera and ZXing.

For camera access:

- Use a phone/tablet with a working camera.
- Allow camera permission.
- For a deployed website, use HTTPS.
- `localhost` is allowed by modern browsers for local development.

## Withdrawal flow

1. User logs in.
2. User opens Withdraw Supply.
3. User selects a supply.
4. User enters quantity.
5. User clicks Scan Barcode.
6. Camera opens.
7. Barcode is scanned.
8. System verifies that the scanned barcode matches the selected supply.
9. User confirms.
10. Database atomically deducts the quantity.
11. Transaction is recorded.
12. Admin inventory updates automatically.

## Database

The database file is created automatically at:

```text
data/council_inventory.db
```

Do not put the database inside a public web folder.

## Export

Admin → Reports → Export CSV.

The exported file contains:

- Date/Time
- User
- Supply
- Barcode
- Action
- Quantity Change
- Previous Stock
- New Stock
- Remarks

## Important production notes

This project is designed to be a complete local/office application. For deployment to multiple devices outside the same computer, host the Node.js server and SQLite database on one server reachable by the Council devices, and use HTTPS so mobile camera permissions work reliably.

For a larger multi-user production environment, PostgreSQL or MySQL can replace SQLite while keeping the same API/data model.

## Security

- Passwords are hashed server-side.
- Admin routes are protected on the backend.
- User routes are authenticated.
- Inventory deduction is done in a database transaction.
- Quantity cannot become negative.
- Barcode uniqueness is enforced by the database.
- Transaction history is retained even when an inventory item is deactivated.

## PDF report + automatic email

The Admin **Reports** page now has a **PDF + Email Report** button. It:

1. Uses the same transaction data as the CSV export.
2. Generates a landscape A4 PDF report.
3. Downloads the PDF to the Admin computer.
4. Asks the admin for the recipient email address, then emails the PDF (and a copy of the CSV) to the chosen address(es).

Email delivery requires SMTP settings in `.env`. Copy `.env.example` to `.env` and fill in:

```text
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=your-sending-account@example.com
SMTP_PASS=your-smtp-password-or-app-password
SMTP_FROM=your-sending-account@example.com
```

For Google Workspace/Gmail accounts, use an App Password when the account requires one. Do not put a normal account password into source code or commit the `.env` file.

After changing `package.json`, run:

```text
npm install
npm start
```

If SMTP is not configured, the PDF still downloads, but the website will tell the Admin that the email was not sent.


## Dashboard supply cards
- Admin and User dashboards now show clickable cards for each supply.
- Admin cards show current quantity and provide **Add Supplies** and **View Barcodes** actions.
- User cards show current quantity, ask how many pieces to withdraw, then require scanning that many individual barcodes before confirmation.
- Existing itemized barcode validation and stock deduction remain enforced by the server.
