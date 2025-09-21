#!/usr/bin/env bash
set -euo pipefail

# ---------------------------
# User DB credentials (EDIT HERE if needed)
# ---------------------------
DB_USER="${DB_USER:-root}"
DB_PASS="${DB_PASS:-Rash@2004}"
DB_HOST="${DB_HOST:-localhost}"
DB_NAME="${DB_NAME:-manufacturing_db}"

# echo values (safe-ish) - don't print password in prod, but user asked for a one-shot script
echo "Using DB_USER=${DB_USER}, DB_HOST=${DB_HOST}, DB_NAME=${DB_NAME}"

# ---------------------------
# Install Python dependencies
# ---------------------------
echo "Installing Python packages..."
# prefer pip3 if available
if command -v pip3 >/dev/null 2>&1; then
  PIP=pip3
else
  PIP=pip
fi
$PIP install --upgrade pip >/dev/null 2>&1 || true
$PIP install flask flask-cors flask-sqlalchemy pymysql pandas openpyxl >/dev/null

# ---------------------------
# Ensure mysql client exists (optional)
# ---------------------------
if ! command -v mysql >/dev/null 2>&1; then
  echo "Warning: 'mysql' CLI not found. The script will still write files but cannot auto-create the database."
  echo "If you want automatic DB creation, install the MySQL client or create the database manually:"
  echo "  CREATE DATABASE ${DB_NAME};"
else
  echo "Creating database ${DB_NAME} if it doesn't exist..."
  # create database non-interactively
  mysql -u"${DB_USER}" -p"${DB_PASS}" -h "${DB_HOST}" -e "CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;" || {
    echo "Failed to create DB using provided credentials. Please create the database manually and re-run the script."
  }
fi

# ---------------------------
# Create project folders
# ---------------------------
BASE_DIR="$(pwd)/manufacturing-app"
BACKEND_DIR="${BASE_DIR}/backend"
FRONTEND_DIR="${BASE_DIR}/frontend"
mkdir -p "$BACKEND_DIR" "$FRONTEND_DIR"

# ---------------------------
# Write backend/app.py
# ---------------------------
cat > "${BACKEND_DIR}/app.py" <<'PYCODE'
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
import os, pandas as pd, tempfile

# ---------------- CONFIG ----------------
DB_USER = os.environ.get("DB_USER", "root")
DB_PASS = os.environ.get("DB_PASS", "Rash@2004")
DB_HOST = os.environ.get("DB_HOST", "localhost")
DB_NAME = os.environ.get("DB_NAME", "manufacturing_db")
DB_URI = f"mysql+pymysql://{DB_USER}:{DB_PASS}@{DB_HOST}/{DB_NAME}"

app = Flask(__name__)
app.config["SQLALCHEMY_DATABASE_URI"] = DB_URI
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
db = SQLAlchemy(app)
CORS(app)

# ---------------- MODELS ----------------
class Product(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100))
    type = db.Column(db.String(20)) # raw or finished
    stock_qty = db.Column(db.Integer, default=0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

class BOM(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    product_id = db.Column(db.Integer, db.ForeignKey("product.id"))
    components = db.Column(db.Text)  # JSON string
    operations = db.Column(db.Text)  # JSON string
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

class ManufacturingOrder(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    product_id = db.Column(db.Integer, db.ForeignKey("product.id"))
    quantity = db.Column(db.Integer)
    status = db.Column(db.String(20), default="planned")
    start_date = db.Column(db.String(50))
    deadline = db.Column(db.String(50))
    assignee = db.Column(db.String(100))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

class WorkOrder(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    mo_id = db.Column(db.Integer, db.ForeignKey("manufacturing_order.id"))
    operation = db.Column(db.String(100))
    work_center = db.Column(db.String(100))
    planned_time_mins = db.Column(db.Integer)
    status = db.Column(db.String(20), default="planned")
    operator_id = db.Column(db.String(50))
    start_time = db.Column(db.DateTime)
    end_time = db.Column(db.DateTime)
    comments = db.Column(db.Text)

class StockLedger(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    product_id = db.Column(db.Integer, db.ForeignKey("product.id"))
    movement_type = db.Column(db.String(10)) # in / out
    quantity = db.Column(db.Integer)
    reference = db.Column(db.String(50))
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)

# ---------------- INIT DB ----------------
with app.app_context():
    db.create_all()

def to_dict(obj):
    return {c.name: getattr(obj, c.name) for c in obj.__table__.columns}

# ---------------- ROUTES ----------------
@app.route("/api/products", methods=["GET","POST"])
def products():
    if request.method == "POST":
        d = request.json
        prod = Product(name=d["name"], type=d.get("type","raw"), stock_qty=int(d.get("stock_qty",0)))
        db.session.add(prod); db.session.commit()
        return jsonify(to_dict(prod)), 201
    return jsonify([to_dict(p) for p in Product.query.all()])

@app.route("/api/bom", methods=["POST","GET"])
def bom():
    if request.method=="POST":
        d=request.json
        bom = BOM(product_id=int(d["product_id"]), components=str(d.get("components",[])), operations=str(d.get("operations",[])))
        db.session.add(bom); db.session.commit()
        return jsonify(to_dict(bom)),201
    return jsonify([to_dict(b) for b in BOM.query.all()])

@app.route("/api/orders", methods=["GET","POST","PUT","DELETE"])
def orders():
    if request.method=="POST":
        d=request.json
        mo=ManufacturingOrder(product_id=int(d["product_id"]), quantity=int(d.get("quantity",1)), start_date=d.get("start_date"), deadline=d.get("deadline"), assignee=d.get("assignee"))
        db.session.add(mo); db.session.commit()
        return jsonify(to_dict(mo)),201
    if request.method=="GET":
        status=request.args.get("status")
        q=ManufacturingOrder.query
        if status: q=q.filter_by(status=status)
        return jsonify([to_dict(m) for m in q.all()])
    if request.method=="PUT":
        d=request.json
        mo=ManufacturingOrder.query.get(int(d["id"]))
        if not mo: return jsonify({"error":"Not found"}),404
        for k,v in d.items():
            if hasattr(mo, k):
                setattr(mo,k,v)
        db.session.commit(); return jsonify(to_dict(mo))
    if request.method=="DELETE":
        mo=ManufacturingOrder.query.get(int(request.args.get("id")))
        if not mo: return jsonify({"error":"Not found"}),404
        db.session.delete(mo); db.session.commit()
        return jsonify({"deleted":mo.id})

@app.route("/api/work-orders", methods=["GET","POST"])
def work_orders():
    if request.method=="POST":
        d=request.json
        wo=WorkOrder(mo_id=int(d["mo_id"]), operation=d["operation"], work_center=d.get("work_center"), planned_time_mins=int(d.get("planned_time_mins",0)))
        db.session.add(wo); db.session.commit()
        return jsonify(to_dict(wo)),201
    return jsonify([to_dict(w) for w in WorkOrder.query.all()])

@app.route("/api/work-orders/<int:wo_id>/status", methods=["PUT"])
def update_wo_status(wo_id):
    d=request.json
    wo=WorkOrder.query.get(wo_id)
    if not wo: return jsonify({"error":"Not found"}),404
    wo.status=d["status"]
    if d["status"]=="started": wo.start_time=datetime.utcnow()
    if d["status"]=="completed": wo.end_time=datetime.utcnow()
    db.session.commit()
    # NOTE: stock consumption automation can be added here later
    return jsonify(to_dict(wo))

@app.route("/api/stock", methods=["GET","POST"])
def stock():
    if request.method=="POST":
        d=request.json
        entry=StockLedger(product_id=int(d["product_id"]), movement_type=d["movement_type"], quantity=int(d["quantity"]), reference=d.get("reference"))
        db.session.add(entry)
        prod=Product.query.get(int(d["product_id"]))
        if prod:
            if d["movement_type"]=="in": prod.stock_qty += int(d["quantity"])
            else: prod.stock_qty -= int(d["quantity"])
        db.session.commit()
        return jsonify(to_dict(entry)),201
    return jsonify([to_dict(s) for s in StockLedger.query.order_by(StockLedger.timestamp.desc()).limit(100).all()])

@app.route("/api/reports/orders", methods=["GET"])
def reports():
    total=ManufacturingOrder.query.count()
    completed=ManufacturingOrder.query.filter_by(status="done").count()
    inprog=ManufacturingOrder.query.filter_by(status="in_progress").count()
    planned=ManufacturingOrder.query.filter_by(status="planned").count()
    return jsonify({"total":total,"completed":completed,"in_progress":inprog,"planned":planned})

@app.route("/api/reports/export", methods=["GET"])
def export_report():
    mos=ManufacturingOrder.query.all()
    rows=[to_dict(m) for m in mos]
    df=pd.DataFrame(rows)
    tmp=tempfile.NamedTemporaryFile(delete=False,suffix=".xlsx")
    df.to_excel(tmp.name,index=False)
    return send_file(tmp.name,as_attachment=True,download_name="mo_report.xlsx")

if __name__=="__main__":
    print("✅ Backend running on http://127.0.0.1:5000")
    app.run(debug=True, host="0.0.0.0", port=5000)
PYCODE

# ---------------------------
# FRONTEND files
# ---------------------------
cat > "${FRONTEND_DIR}/styles.css" <<'CSS'
body { font-family: Arial, sans-serif; margin: 20px; }
nav a { margin-right: 8px; }
table { width: 100%; border-collapse: collapse; margin-top: 10px; }
th, td { border: 1px solid #ccc; padding: 6px; }
form input, form select, textarea { margin: 5px; padding: 5px; }
button { padding: 6px 10px; }
.card { display:inline-block; padding:10px 16px; border-radius:6px; background:#f0f0f0; margin-right:8px; }
CSS

cat > "${FRONTEND_DIR}/index.html" <<'HTML'
<!doctype html>
<html>
<head><meta charset="utf-8"/><title>Dashboard</title><link rel="stylesheet" href="styles.css"/></head>
<body>
<header>
  <h1>Manufacturing Dashboard</h1>
  <nav>
    <a href="index.html">Dashboard</a> |
    <a href="products.html">Products</a> |
    <a href="bom.html">BOM</a> |
    <a href="orders.html">Orders</a> |
    <a href="work_orders.html">Work Orders</a> |
    <a href="stock.html">Stock</a> |
    <a href="reports.html">Reports</a>
  </nav>
</header>
<main><section id="kpis"></section></main>
<script src="scripts.js"></script>
</body></html>
HTML

cat > "${FRONTEND_DIR}/products.html" <<'HTML'
<!doctype html>
<html>
<head><meta charset="utf-8"/><title>Products</title><link rel="stylesheet" href="styles.css"/></head>
<body>
<header>
  <h1>Products</h1>
  <nav>
    <a href="index.html">Dashboard</a> |
    <a href="products.html">Products</a> |
    <a href="bom.html">BOM</a> |
    <a href="orders.html">Orders</a> |
    <a href="work_orders.html">Work Orders</a> |
    <a href="stock.html">Stock</a> |
    <a href="reports.html">Reports</a>
  </nav>
</header>
<main>
<form id="productForm">
  <input name="name" placeholder="Name" required/>
  <select name="type"><option value="raw">Raw</option><option value="finished">Finished</option></select>
  <input name="stock_qty" type="number" value="0"/>
  <button type="submit">Add Product</button>
</form>
<table id="productsTable"><thead><tr><th>ID</th><th>Name</th><th>Type</th><th>Stock</th></tr></thead><tbody></tbody></table>
</main>
<script src="scripts.js"></script>
</body></html>
HTML

cat > "${FRONTEND_DIR}/bom.html" <<'HTML'
<!doctype html>
<html>
<head><meta charset="utf-8"/><title>BOM</title><link rel="stylesheet" href="styles.css"/></head>
<body>
<header>
  <h1>Bill of Materials</h1>
  <nav>
    <a href="index.html">Dashboard</a> |
    <a href="products.html">Products</a> |
    <a href="bom.html">BOM</a> |
    <a href="orders.html">Orders</a> |
    <a href="work_orders.html">Work Orders</a> |
    <a href="stock.html">Stock</a> |
    <a href="reports.html">Reports</a>
  </nav>
</header>
<main>
<form id="bomForm">
  <input name="product_id" placeholder="Product ID" required/>
  <textarea name="components" placeholder='[{"component_id":1,"qty":4}]' rows="4"></textarea>
  <textarea name="operations" placeholder='[{"name":"Assembly","time_mins":60,"work_center":"Line1"}]' rows="4"></textarea>
  <button type="submit">Add BOM</button>
</form>
<table id="bomTable"><thead><tr><th>ID</th><th>Product</th><th>Components</th><th>Operations</th></tr></thead><tbody></tbody></table>
</main>
<script src="scripts.js"></script>
</body></html>
HTML

cat > "${FRONTEND_DIR}/orders.html" <<'HTML'
<!doctype html>
<html>
<head><meta charset="utf-8"/><title>Orders</title><link rel="stylesheet" href="styles.css"/></head>
<body>
<header>
  <h1>Manufacturing Orders</h1>
  <nav>
    <a href="index.html">Dashboard</a> |
    <a href="products.html">Products</a> |
    <a href="bom.html">BOM</a> |
    <a href="orders.html">Orders</a> |
    <a href="work_orders.html">Work Orders</a> |
    <a href="stock.html">Stock</a> |
    <a href="reports.html">Reports</a>
  </nav>
</header>
<main>
<form id="moForm">
  <input name="product_id" placeholder="Product ID" required/>
  <input name="quantity" type="number" value="1"/>
  <input name="deadline" type="date"/>
  <button type="submit">Create Order</button>
</form>
<table id="moTable"><thead><tr><th>ID</th><th>Product</th><th>Qty</th><th>Status</th><th>Actions</th></tr></thead><tbody></tbody></table>
</main>
<script src="scripts.js"></script>
</body></html>
HTML

cat > "${FRONTEND_DIR}/work_orders.html" <<'HTML'
<!doctype html>
<html>
<head><meta charset="utf-8"/><title>Work Orders</title><link rel="stylesheet" href="styles.css"/></head>
<body>
<header>
  <h1>Work Orders</h1>
  <nav>
    <a href="index.html">Dashboard</a> |
    <a href="products.html">Products</a> |
    <a href="bom.html">BOM</a> |
    <a href="orders.html">Orders</a> |
    <a href="work_orders.html">Work Orders</a> |
    <a href="stock.html">Stock</a> |
    <a href="reports.html">Reports</a>
  </nav>
</header>
<main>
<table id="woTable"><thead><tr><th>ID</th><th>MO ID</th><th>Operation</th><th>Center</th><th>Status</th><th>Actions</th></tr></thead><tbody></tbody></table>
</main>
<script src="scripts.js"></script>
</body></html>
HTML

cat > "${FRONTEND_DIR}/stock.html" <<'HTML'
<!doctype html>
<html>
<head><meta charset="utf-8"/><title>Stock</title><link rel="stylesheet" href="styles.css"/></head>
<body>
<header>
  <h1>Stock Ledger</h1>
  <nav>
    <a href="index.html">Dashboard</a> |
    <a href="products.html">Products</a> |
    <a href="bom.html">BOM</a> |
    <a href="orders.html">Orders</a> |
    <a href="work_orders.html">Work Orders</a> |
    <a href="stock.html">Stock</a> |
    <a href="reports.html">Reports</a>
  </nav>
</header>
<main>
<table id="stockTable"><thead><tr><th>ID</th><th>Product</th><th>Type</th><th>Qty</th><th>Ref</th><th>Time</th></tr></thead><tbody></tbody></table>
</main>
<script src="scripts.js"></script>
</body></html>
HTML

cat > "${FRONTEND_DIR}/reports.html" <<'HTML'
<!doctype html>
<html>
<head><meta charset="utf-8"/><title>Reports</title><link rel="stylesheet" href="styles.css"/></head>
<body>
<header>
  <h1>Reports</h1>
  <nav>
    <a href="index.html">Dashboard</a> |
    <a href="products.html">Products</a> |
    <a href="bom.html">BOM</a> |
    <a href="orders.html">Orders</a> |
    <a href="work_orders.html">Work Orders</a> |
    <a href="stock.html">Stock</a> |
    <a href="reports.html">Reports</a>
  </nav>
</header>
<main>
<button onclick="downloadReport()">Export Excel</button>
</main>
<script src="scripts.js"></script>
</body></html>
HTML

cat > "${FRONTEND_DIR}/scripts.js" <<'JSS'
const API="http://127.0.0.1:5000/api";
async function api(path,opts={}){return fetch(API+path,{headers:{"Content-Type":"application/json"},...opts});}
async function loadKPIs(){const r=await api("/reports/orders");const d=await r.json();if(document.getElementById("kpis"))document.getElementById("kpis").innerHTML=`<div class="card">Total: ${d.total}</div><div class="card">Planned: ${d.planned}</div><div class="card">In Progress: ${d.in_progress}</div><div class="card">Completed: ${d.completed}</div>`;}
async function loadProducts(){const r=await api("/products");const data=await r.json();const tbody=document.querySelector("#productsTable tbody");if(!tbody)return;tbody.innerHTML="";data.forEach(p=>{tbody.innerHTML+=`<tr><td>${p.id}</td><td>${p.name}</td><td>${p.type}</td><td>${p.stock_qty}</td></tr>`;});}
async function loadBOMs(){const r=await api("/bom");const data=await r.json();const tbody=document.querySelector("#bomTable tbody");if(!tbody)return;tbody.innerHTML="";data.forEach(b=>{tbody.innerHTML+=`<tr><td>${b.id}</td><td>${b.product_id}</td><td><pre>${b.components}</pre></td><td><pre>${b.operations}</pre></td></tr>`;});}
async function loadMOs(){const r=await api("/orders");const data=await r.json();const tbody=document.querySelector("#moTable tbody");if(!tbody)return;tbody.innerHTML="";data.forEach(m=>{tbody.innerHTML+=`<tr><td>${m.id}</td><td>${m.product_id}</td><td>${m.quantity}</td><td>${m.status}</td><td><button onclick="deleteMO(${m.id})">Delete</button></td></tr>`;});}
async function deleteMO(id){await api("/orders?id="+id,{method:"DELETE"});loadMOs();}
async function loadWOs(){const r=await api("/work-orders");const data=await r.json();const tbody=document.querySelector("#woTable tbody");if(!tbody)return;tbody.innerHTML="";data.forEach(w=>{tbody.innerHTML+=`<tr><td>${w.id}</td><td>${w.mo_id}</td><td>${w.operation}</td><td>${w.work_center}</td><td>${w.status}</td><td><button onclick="updateWO(${w.id},'started')">Start</button><button onclick="updateWO(${w.id},'completed')">Complete</button></td></tr>`;});}
async function updateWO(id,status){await api("/work-orders/"+id+"/status",{method:"PUT",body:JSON.stringify({status})});loadWOs();}
async function loadStock(){const r=await api("/stock");const data=await r.json();const tbody=document.querySelector("#stockTable tbody");if(!tbody)return;tbody.innerHTML="";data.forEach(s=>{tbody.innerHTML+=`<tr><td>${s.id}</td><td>${s.product_id}</td><td>${s.movement_type}</td><td>${s.quantity}</td><td>${s.reference||''}</td><td>${s.timestamp||''}</td></tr>`;});}
function downloadReport(){window.location=API+"/reports/export";}
document.addEventListener("DOMContentLoaded",()=>{
  if(document.getElementById("kpis")) loadKPIs();
  if(document.getElementById("productsTable")) {
    loadProducts();
    document.getElementById("productForm").addEventListener("submit", async (e)=> {
      e.preventDefault();
      const fd = new FormData(e.target);
      const payload = Object.fromEntries(fd.entries());
      await api("/products",{method:"POST", body: JSON.stringify(payload)});
      e.target.reset(); loadProducts();
    });
  }
  if(document.getElementById("bomTable")) {
    loadBOMs();
    document.getElementById("bomForm").addEventListener("submit", async (e)=> {
      e.preventDefault();
      const fd=new FormData(e.target);
      let comps, ops;
      try { comps = JSON.parse(fd.get("components")||"[]"); ops = JSON.parse(fd.get("operations")||"[]"); }
      catch { alert("Invalid JSON in BOM fields"); return; }
      await api("/bom",{method:"POST", body: JSON.stringify({product_id: fd.get("product_id"), components: comps, operations: ops})});
      e.target.reset(); loadBOMs();
    });
  }
  if(document.getElementById("moTable")) {
    loadMOs();
    document.getElementById("moForm").addEventListener("submit", async (e)=> {
      e.preventDefault();
      const fd=new FormData(e.target);
      const payload = { product_id: fd.get("product_id"), quantity: Number(fd.get("quantity")||1), deadline: fd.get("deadline")||null };
      await api("/orders",{method:"POST", body: JSON.stringify(payload)});
      e.target.reset(); loadMOs();
    });
  }
  if(document.getElementById("woTable")) loadWOs();
  if(document.getElementById("stockTable")) loadStock();
});
JSS

# ---------------------------
# Start backend and frontend servers
# ---------------------------
echo "Starting backend (Flask) and frontend (static) servers..."

# export env vars for the running process
export DB_USER DB_PASS DB_HOST DB_NAME

# run backend in background, log to manufacturing-app/backend/backend.log
cd "$BACKEND_DIR"
nohup python3 app.py > backend.log 2>&1 &

# run simple static server for frontend on port 8000
cd "$FRONTEND_DIR"
nohup python3 -m http.server 8000 > frontend.log 2>&1 &

echo "Setup complete."
echo "Backend: http://127.0.0.1:5000 (API base: /api)"
echo "Frontend: http://127.0.0.1:8000/index.html"
echo ""
echo "Logs: "
echo " - backend log: ${BACKEND_DIR}/backend.log"
echo " - frontend log: ${FRONTEND_DIR}/frontend.log"
echo ""
echo "If the backend fails to start, check logs and ensure MySQL server is running and"
echo "the database '${DB_NAME}' exists and credentials are correct."

