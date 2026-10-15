FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY index.html styles.css stickers.css master-data.css app.js asset-tools.js master-data.js asset_api.py master_data_api.py schema.sql server.py MANUAL.md ./
COPY assets/ ./assets/
ENV PYTHONUNBUFFERED=1 PORT=8080 ASSET_DB_PATH=/data/govasset.sqlite3
EXPOSE 8080
CMD ["python", "server.py"]
