FROM python:3.10-slim

WORKDIR /app

COPY requirements.txt .

# Thêm đầy đủ công cụ build C (build-essential, gcc, libffi-dev, git, v.v.)
RUN apt-get update && apt-get install -y \
    git \
    build-essential \
    gcc \
    libffi-dev \
    libssl-dev \
    python3-dev

RUN pip install --upgrade pip
RUN pip install git+https://github.com/Metadream/sui-pysui.git@v0.54.0
RUN pip install -r requirements.txt

COPY . .

CMD ["python", "main.py"]
