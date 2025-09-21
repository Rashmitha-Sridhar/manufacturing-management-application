Local backend helper

Environment variables (PowerShell):

```powershell
$env:DB_DIALECT='sqlite'
$env:SQLITE_PATH='dev_manufacturing.db'
$env:DB_HOST='localhost'
$env:DB_USER='root'
$env:DB_PASS='Rash@2004'
$env:DB_NAME='manufacturing_db'
python app.py
```

For local development use DB_DIALECT=sqlite to avoid needing a MySQL server.

Auth endpoints:
- POST /api/auth/signup {email,password,name,role}
- POST /api/auth/login {email,password}
- POST /api/auth/forgot {email}  (returns OTP in body for local dev)
