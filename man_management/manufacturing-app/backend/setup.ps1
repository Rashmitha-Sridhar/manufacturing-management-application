# Run this from the backend folder in PowerShell to create a venv and install requirements
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
Write-Host "Setup complete. Activate the venv with .\.venv\Scripts\Activate.ps1 and run python app.py"