import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { env } from 'hono/adapter';
import { Index } from '@upstash/vector';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';

const semanticSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: 25,
    separators: [" "],
    chunkOverlap: 12
});

const app = new Hono();

type Environment = {
    VECTOR_URL: string;
    VECTOR_TOKEN: string;
}

app.use(cors());

const WHITE_LIST = ['swear'];
const PROFANITY_THRESHOLD = 0.86;

app.post('/api', async (c) => {
    if (c.req.header('Content-Type') !== 'application/json') {
        return c.json({ error: "JSON body expected" }, { status: 406 });
    }

    try {
        const { VECTOR_TOKEN, VECTOR_URL } = env<Environment>(c);

        const index = new Index({
            url: VECTOR_URL,
            token: VECTOR_TOKEN,
            cache: false
        });

        const body = await c.req.json();
        let { message } = body as { message: string };

        if (!message) {
            return c.json({ error: "message is required" }, { status: 400 });
        }

        if (message.length > 1000) {
            return c.json({ error: "Message can only be at most 1000 characters" }, { status: 413 });
        }

        message = message
            .split(/\s/)
            .filter((word) => !WHITE_LIST.includes(word.toLowerCase()))
            .join(' ');

        const [semanticChunks, wordChunks] = await Promise.all([
            splitTextIntoSemantics(message),
            splitTextIntoWords(message)
        ])

        const flaggedFor = new Set<{ score: number; text: string }>();

        const vectorRes = await Promise.all([
            ...wordChunks.map(async (workChunk) => {
                const [vector] = await index.query({
                    topK: 1,
                    data: workChunk,
                    includeMetadata: true
                })

                if (vector && vector.score > 0.95) {
                    flaggedFor.add({
                        text: vector.metadata!.text as string,
                        score: vector.score
                    })
                }

                return { score: 0 }
            }),

            ...semanticChunks.map(async (semanticChunk) => {
                const [vector] = await index.query({
                    topK: 1,
                    data: semanticChunk,
                    includeMetadata: true
                })

                if (vector && vector.score > PROFANITY_THRESHOLD) {
                    flaggedFor.add({
                        text: vector.metadata!.text as string,
                        score: vector.score
                    })
                }

                return vector!
            }),

        ])

        if (flaggedFor.size > 0) {

            const sorted = Array.from(flaggedFor).sort((a, b) => a.score > b.score ? -1 : 1)[0];

            return c.json({
                isProfanity: true,
                score: sorted.score,
                flaggedFor: sorted.text
            });
        } else {
            const mostProfaneChunk = vectorRes.sort((a, b) => a.score > b.score ? -1 : 1)[0];
            return c.json({
                isProfanity: false,
                score: mostProfaneChunk.score,
            });
        }

    } catch (error) {
        console.error(error);
        return c.json({ error: "Something went wrong" }, { status: 500 });
    }

});

function splitTextIntoWords(text: string) {
    return text.split(/\s/);
}

async function splitTextIntoSemantics(text: string) {
    if (text.split(/\s/).length > 1) return []
    const document = await semanticSplitter.createDocuments([text]);
    const chunks = document.map((chunk) => chunk.pageContent);
    return chunks
}

export default app;