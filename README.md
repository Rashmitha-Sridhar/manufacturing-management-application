


**VIDEO LINK** - https://drive.google.com/open?id=1ubW4U1udJs2hxOrzQHs2ipilHpHY_dGv&usp=drive_copy



# manufacturing-management-application
Manufacturing Management System

A lightweight backend application to manage manufacturing processes and operations.
Built with Python and MySQL, this project includes backend APIs, database setup scripts, and utilities to streamline management tasks.

Features

RESTful backend server (app.py)

MySQL integration with setup script (setup_mysql.sh)

Cross-platform setup support (Linux/Mac .sh, Windows .ps1)

Requirements managed via requirements.txt

Cleanup and environment management scripts

Getting Started
Prerequisites

Python 3.10+

MySQL Server

Installation

Clone the repository:

git clone https://github.com/your-username/your-repo.git
cd your-repo/man_management/manufacturing-app/backend


Create and activate a virtual environment:

python -m venv .venv
source .venv/bin/activate   # Linux/Mac
.venv\Scripts\activate      # Windows


Install dependencies:

pip install -r requirements.txt


Setup the database:

bash ../../setup_mysql.sh   # Linux/Mac
./setup.ps1                 # Windows


Run the server:

python app.py

Project Structure
man_management/
 ├─ setup_mysql.sh           # Database setup script
 └─ manufacturing-app/
     └─ backend/
        ├─ app.py            # Main backend application
        ├─ requirements.txt  # Python dependencies
        ├─ setup.ps1         # Windows setup script
        └─ cleanup.ps1       # Cleanup utility

Contributing

Contributions are welcome!
Feel free to open issues or submit pull requests to improve this project.
