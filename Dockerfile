FROM python:3.10-slim

WORKDIR /app

COPY requirements.txt .

# Thêm dòng này để cài git
RUN apt-get update && apt-get install -y git

RUN pip install --upgrade pip
RUN pip install git+https://github.com/Metadream/sui-pysui.git@v0.54.0
RUN pip install -r requirements.txt

COPY . .

CMD ["python", "main.py"]
