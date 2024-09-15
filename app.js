if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}
const express = require('express');
const { CosmosClient } = require('@azure/cosmos');
const cors = require('cors');
const axios = require('axios');

const app = express();
const port = process.env.PORT || 8080;

console.log(`Starting server in ${process.env.NODE_ENV || 'development'} mode...`);

const corsOptions = {
    origin: function (origin, callback) {
        console.log(`CORS: Origin = ${origin}`);
        // Allow requests from 'null' origin (file://), localhost, and your production domain
        if (!origin || origin === 'https://yourin.site' || origin === 'null' || origin.includes("localhost")) {
            callback(null, true); // Allow the request
        } else {
            console.log(`CORS: Blocking origin = ${origin}`);
            callback(new Error('Not allowed by CORS'));
        }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], // Allowed HTTP methods
    allowedHeaders: ['Content-Type', 'Authorization'], // Allowed headers
    credentials: true, // Allow credentials (cookies, authorization headers, etc.)
};

// Apply CORS middleware globally to all routes
app.use(cors(corsOptions));

// Handle preflight OPTIONS requests globally
app.options('*', cors(corsOptions));

// Set up Cosmos DB connection
const endpoint = process.env.COSMOS_DB_ENDPOINT;
const key = process.env.COSMOS_DB_KEY;
const databaseId = 'RTP';
const containerId = 'pageanalytics';
const aggContainerId = 'pageanalytics_aggregated'; 

const client = new CosmosClient({ endpoint, key });
const database = client.database(databaseId);
const container = database.container(containerId);
const aggContainer = database.container(aggContainerId);

console.log('Cosmos DB Client initialized');

// Middleware to parse JSON bodies
app.use(express.json());

// Route to handle event tracking from client-side JavaScript
app.post('/api/event', async (req, res) => {
    console.log('Received event POST request');
    console.log('Request Body:', JSON.stringify(req.body, null, 2));

    const eventData = req.body;

    // Get client IP from the request
    let clientIP = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    console.log(`Client IP (before cleanup): ${clientIP}`);

    // Strip the port number if present (e.g., '81.141.228.123:53835' -> '81.141.228.123')
    if (clientIP.includes(':')) {
        clientIP = clientIP.split(':')[0];
    }
    console.log(`Client IP (after cleanup): ${clientIP}`);

    // Check if the request is coming from a local file system (null origin)
    const isLocalFile = req.headers.origin === 'null';

    if (isLocalFile) {
        console.log('Request is from a local file. Using dummy IP.');
        // Assign a dummy IP if the request is from a local file
        clientIP = '123.123.123.123'; // Use a dummy IP here
    }

    // Perform geolocation for the client IP
    try {
        const location = await getLocationFromIP(clientIP);
        console.log('Geolocation result:', location);
        eventData.location = location;
    } catch (err) {
        console.error('Error during geolocation:', err);
    }

    eventData.ip_address = clientIP;
    eventData.id = `event_${Date.now()}`;

    try {
        console.log('Saving event data to Cosmos DB...');
        const { resource: createdItem } = await container.items.create(eventData);
        console.log('Event saved successfully:', createdItem);
        res.status(201).json(createdItem);
    } catch (error) {
        console.error('Error saving event to Cosmos DB:', error);
        res.status(500).json({ error: 'Failed to save event data' });
    }
});

// Function to get location from IP using an external service
async function getLocationFromIP(ip) {
    console.log(`Fetching geolocation for IP: ${ip}`);
    try {
        const response = await axios.get(`https://api.ipgeolocation.io/ipgeo?apiKey=16ee9148978f4e12adf368343a14f818&ip=${ip}`);
        console.log('Geolocation API response:', response.data);
        return {
            city: response.data.city,
            region: response.data.state_prov,
            country: response.data.country_name,
        };
    } catch (error) {
        console.error('Error fetching location from IP:', error);
        return { city: 'unknown', region: 'unknown', country: 'unknown' };
    }
}

// Route to retrieve aggregated page analytics
app.get('/api/aggregated-data', async (req, res) => {
    console.log('Received request for aggregated data');
    console.log('Query Parameters:', req.query);

    const { page, date } = req.query;

    try {
        console.log(`Querying Cosmos DB for aggregated data with page: ${page} and date: ${date}`);
        const querySpec = {
            query: 'SELECT * FROM c WHERE c.page = @page AND c.date = @date',
            parameters: [
                { name: '@page', value: page },
                { name: '@date', value: date }
            ]
        };

        const { resources: aggregatedData } = await aggContainer.items.query(querySpec).fetchAll();

        console.log('Aggregated data retrieved:', aggregatedData);
        
        let totalPageViews = 0;
        let totalDistinctUsers = 0;
        let totalNewUsers = 0;
        let totalCumulativeDailyDistinctUsers = 0;

        const hourlyData = Array(24).fill(null).map((_, hour) => ({
            hour,
            page_loads: 0,
            distinct_users: 0,
            new_users: 0,
            cumulative_daily_distinct_users: 0
        }));

        aggregatedData.forEach(item => {
            const hour = item.hour;

            hourlyData[hour].page_loads += item.page_loads || 0;
            hourlyData[hour].distinct_users += item.distinct_users || 0;
            hourlyData[hour].new_users += item.new_users || 0;
            hourlyData[hour].cumulative_daily_distinct_users += item.cumulative_daily_distinct_users || 0;

            totalPageViews += item.page_loads || 0;
            totalDistinctUsers += item.distinct_users || 0;
            totalNewUsers += item.new_users || 0;
            totalCumulativeDailyDistinctUsers += item.cumulative_daily_distinct_users || 0;
        });

        console.log('Aggregated result prepared:', {
            totalPageViews,
            totalDistinctUsers,
            totalNewUsers,
            totalCumulativeDailyDistinctUsers,
            hourlyData
        });

        res.status(200).json({
            totalPageViews,
            totalDistinctUsers,
            totalNewUsers,
            totalCumulativeDailyDistinctUsers,
            aggregatedHourlyData: hourlyData
        });
    } catch (error) {
        console.error('Error querying aggregated data from Cosmos DB:', error);
        res.status(500).json({ error: 'Failed to retrieve aggregated data' });
    }
});

// Example route to retrieve events by session ID
app.get('/api/events/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    console.log(`Received request to retrieve events for sessionId: ${sessionId}`);

    try {
        const querySpec = {
            query: 'SELECT * FROM c WHERE c.session_id = @sessionId',
            parameters: [{ name: '@sessionId', value: sessionId }]
        };

        const { resources: events } = await container.items.query(querySpec).fetchAll();
        console.log('Events retrieved for session:', events);
        res.status(200).json(events);
    } catch (error) {
        console.error('Error querying events from Cosmos DB:', error);
        res.status(500).json({ error: 'Failed to retrieve events' });
    }
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
