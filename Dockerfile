FROM python:3.10-slim

WORKDIR /app

COPY requirements.txt .

RUN apt-get update && apt-get install -y \
    git \
    build-essential \
    gcc \
    libffi-dev \
    libssl-dev \
    python3-dev \
    pkg-config \
    libpq-dev \
    libgmp-dev \
    libsecp256k1-dev \
    make \
    cmake

RUN pip install --upgrade pip setuptools wheel

RUN pip install git+https://github.com/Metadream/sui-pysui.git@v0.54.0

RUN pip install -r requirements.txt

COPY . .

CMD ["python", "main.py"]
