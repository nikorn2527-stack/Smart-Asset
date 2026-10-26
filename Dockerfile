FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY . ./
ENV PYTHONUNBUFFERED=1 PORT=8080 ASSET_DB_PATH=/data/govasset.sqlite3
EXPOSE 8080
CMD ["python", "server.py"]
