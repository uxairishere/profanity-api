import fs from 'fs';
import csv from 'csv-parser';
import { Index } from "@upstash/vector"
import "dotenv/config"

interface Row {
    text: string;
}

const index = new Index({
    url: process.env.VECTOR_URL,
    token: process.env.VECTOR_TOKEN,
})

async function parseCSV(filePath: string): Promise<Row[]> {
    return new Promise((resolve, reject) => {
        const rows: Row[] = [];
        fs.createReadStream(filePath)
            .pipe(csv({ separator: ',' }))
            .on('data', (data) => {
                rows.push(data);
            })
            .on('error', (error) => {
                reject(error);
            })
            .on('end', () => {
                resolve(rows);
            });
    });
}

const STEP = 30;
const seed = async () => {
    const data = await parseCSV('training_data.csv');

    for (let i = 0; i < data.length; i += STEP) {
        const chunk = data.slice(i, i + STEP);

        const formatted = chunk.map((row, batchIndex) => ({
            id: i + batchIndex,
            data: row.text,
            metadata: {
                text: row.text
            }
        }));

        await index.upsert(formatted);
    }
}

seed();