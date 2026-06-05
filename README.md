# 🏥 PharmaSys — Pharmacy Management System

## Project Structure

```
pharmacy-system/
├── backend/
│   ├── server.js          ← Node.js API server
│   ├── package.json
│   └── data/              ← JSON files saved on YOUR PC (auto-created)
│       ├── medicines.json
│       ├── sales.json
│       └── suppliers.json
└── frontend/
    └── src/
        └── App.jsx        ← Full React UI (PharmacySystem.jsx)
```

---

## ⚡ Quick Setup (Step by Step)

### Step 1 — Backend Setup

```bash
# Create backend folder
mkdir pharmacy-system && cd pharmacy-system
mkdir backend && cd backend

# Copy server.js and package.json here, then:
npm install

# Start the server
npm start
# OR with auto-reload:
npm run dev
```

Server runs at: `http://localhost:3001`
Data saves to: `./data/` folder on your PC ✅

---

### Step 2 — Frontend Setup

```bash
# In a new terminal, from pharmacy-system folder:
npm create vite@latest frontend -- --template react
cd frontend
npm install

# Replace src/App.jsx with PharmacySystem.jsx content
# Then start:
npm run dev
```

Frontend runs at: `http://localhost:5173`

---

## 📡 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/dashboard/stats | Dashboard summary stats |
| GET | /api/medicines | List all medicines |
| POST | /api/medicines | Add new medicine |
| PUT | /api/medicines/:id | Update medicine |
| DELETE | /api/medicines/:id | Delete medicine |
| GET | /api/medicines/alerts | Expiry & low stock alerts |
| GET | /api/sales | Sales history |
| POST | /api/sales | Create sale (updates stock) |
| GET | /api/suppliers | List suppliers |
| POST | /api/suppliers | Add supplier |
| PUT | /api/suppliers/:id | Update supplier |
| DELETE | /api/suppliers/:id | Delete supplier |
| GET | /api/reports/weekly | 7-day revenue report |
| GET | /api/reports/top-medicines | Top selling medicines |

---

## 💾 Data Storage

All data is stored as **JSON files on your PC** in `backend/data/`:
- `medicines.json` — Medicine inventory
- `sales.json` — All sales transactions
- `suppliers.json` — Supplier records

No database needed — everything is on your machine! ✅

---

## 🧩 Features

- ✅ Dashboard with live stats
- ✅ Medicine inventory (Add / Edit / Delete / Search)
- ✅ POS / New Sale with cart system
- ✅ Sales history
- ✅ Suppliers management
- ✅ Expiry & Low stock alerts
- ✅ Weekly revenue reports
- ✅ Dark mode
- ✅ Data saved to PC (JSON files)

---

## 🔧 Next Steps (we'll build these)

- [ ] Print receipts / PDF billing
- [ ] User authentication (login/logout)
- [ ] Barcode scanner support
- [ ] Export reports to Excel
- [ ] Purchase orders from suppliers
- [ ] SMS/WhatsApp alerts for low stock