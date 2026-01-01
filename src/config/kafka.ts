import { Kafka, logLevel } from 'kafkajs';
import dotenv from 'dotenv';

dotenv.config();

const kafka = new Kafka({
  clientId: 'jiaa-data-service',
  brokers: [(process.env.KAFKA_BROKER || 'localhost:9092')],
  logLevel: logLevel.INFO
});

const consumer = kafka.consumer({ groupId: 'jiaa-data-group' });

export const connectKafka = async () => {
  await consumer.connect();
  console.log('Kafka Consumer connected');
};

export { consumer };
