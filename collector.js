import { fetch } from "bun";
import { initializeDatabase } from './schema.js';
import { unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const groupId = process.env.groupid;
const memberFile = Bun.file(".users.json");
const memberMap = await memberFile.json();
const DB_PATH = 'trackmania_wrapped.db';

async function getAuthToken() {
    console.log("🔑 Getting auth token...");
    const response1 = await fetch('https://public-ubiservices.ubi.com/v3/profiles/sessions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Ubi-AppId': '86263886-327a-4328-ac69-527f0d20a237',
            'Authorization': `Basic ${process.env.userpw}`,
            'User-Agent': 'Local Leaderboard'
        },
        body: JSON.stringify({ "audience": "NadeoLiveServices" })
    });

    const data1 = await response1.json();

    if (data1.httpCode === 429) {
        return new Response("Rate limiting hat gekickt", { status: 429 });
    }

    const response2 = await fetch('https://prod.trackmania.core.nadeo.online/v2/authentication/token/ubiservices', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `ubi_v1 t=${data1.ticket}`,
            'User-Agent': 'Local Leaderboard'
        },
        body: JSON.stringify({ "audience": "NadeoLiveServices" })
    });

    const data2 = await response2.json();
    console.log("✅ Auth token received");
    return { accessToken: data2.accessToken };
}

export async function collectYearData() {
    const currentYear = new Date().getFullYear();
    console.log(`🎮 Starting Trackmania data collection for ${currentYear}`);
    
    // Delete old database if it exists
    if (existsSync(DB_PATH)) {
        console.log("🗑️ Removing old database...");
        await unlink(DB_PATH);
    }
    
    const db = await initializeDatabase();
    const token = await getAuthToken();
    
    if (!token.accessToken) {
        throw new Error("Failed to get auth token");
    }
    
    // Update the months loop to only get months up to current month
    const currentMonth = new Date().getMonth(); // 0-based index
    console.log("📅 Fetching monthly campaigns...");
    const monthPromises = [];
    for (let offset = 0; offset <= currentMonth; offset++) {
        monthPromises.push(
            fetch('https://live-services.trackmania.nadeo.live/api/token/campaign/month?length=1&offset=' + offset, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `nadeo_v1 t=${token.accessToken}`,
                    'User-Agent': 'Trackmania Wrapped'
                }
            }).then(r => r.json())
        );
    }
    
    const months = await Promise.all(monthPromises);
    console.log("✅ Monthly campaigns fetched");
    
    // Collect all map UIDs
    console.log("🗺️ Processing map information...");
    const mapUids = new Map();
    months.forEach((monthData) => {
        const month = monthData.monthList[0].month;  // Get actual month from API response
        monthData.monthList[0].days.forEach(day => {
            if (day.mapUid) {
                mapUids.set(day.mapUid, {
                    month: month,
                    monthDay: day.monthDay
                });
            }
        });
    });
    
    console.log(`📍 Found ${mapUids.size} unique maps`);
    
    // Get map details in batches of 50
    const mapUidArray = [...mapUids.keys()];
    const mapBatches = [];
    for (let i = 0; i < mapUidArray.length; i += 50) {
        const batch = mapUidArray.slice(i, i + 50);
        mapBatches.push(batch);
    }
    
    console.log("🎯 Fetching map details...");
    let processedMaps = 0;
    let lastProgressStep = 0;
    for (const batch of mapBatches) {
        const mapCommaList = batch.join(',');
        const mapData = await fetch(
            `https://live-services.trackmania.nadeo.live/api/token/map/get-multiple?mapUidList=${mapCommaList}`,
            {
                headers: {
                    'Authorization': `nadeo_v1 t=${token.accessToken}`,
                    'User-Agent': 'Trackmania Wrapped'
                }
            }
        ).then(r => r.json());
        
        // Update map storage to use currentYear
        const stmt = db.prepare(`
            INSERT OR REPLACE INTO maps (uid, day, month, year, bronze_time, silver_time, gold_time, author_time, thumbnail_url)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        
        mapData.mapList.forEach(map => {
            const dateInfo = mapUids.get(map.uid);
            
            stmt.run(
                map.uid,
                dateInfo.monthDay,
                dateInfo.month,
                currentYear,
                map.bronzeTime,
                map.silverTime,
                map.goldTime,
                map.authorTime,
                map.thumbnailUrl
            );
        });

        processedMaps += batch.length;
        const currentProgress = Math.floor(processedMaps/mapUids.size*100);
        if (currentProgress >= lastProgressStep + 10) {
            console.log(`   Progress: ${currentProgress}%`);
            lastProgressStep = Math.floor(currentProgress/10) * 10;
        }
    }
    
    console.log("✅ Map details stored in database");
    
    // Get leaderboard data for each map
    console.log("🏆 Fetching leaderboard data...");
    let processedLeaderboards = 0;
    lastProgressStep = 0;
    for (const mapUid of mapUids.keys()) {
        const leaderboard = await fetch(
            `https://live-services.trackmania.nadeo.live/api/token/leaderboard/group/Personal_Best/map/${mapUid}/club/${groupId}/top?length=10&offset=0`,
            {
                headers: {
                    'Authorization': `nadeo_v1 t=${token.accessToken}`,
                    'User-Agent': 'Trackmania Wrapped'
                }
            }
        ).then(r => r.json());
        
        const stmt = db.prepare(`
            INSERT OR REPLACE INTO runs (map_uid, user_id, time, medal, position)
            VALUES (?, ?, ?, ?, ?)
        `);
        
        const mapTimes = db.prepare('SELECT * FROM maps WHERE uid = ?').get(mapUid);
        
        leaderboard.top?.forEach(entry => {
            let medal = '💩';
            if (entry.score <= mapTimes.author_time) medal = '🏎️';
            else if (entry.score <= mapTimes.gold_time) medal = '🥇';
            else if (entry.score <= mapTimes.silver_time) medal = '🥈';
            else if (entry.score <= mapTimes.bronze_time) medal = '🥉';
            
            stmt.run(
                mapUid,
                entry.accountId,
                entry.score,
                medal,
                entry.position
            );
        });

        processedLeaderboards++;
        const currentProgress = Math.floor(processedLeaderboards/mapUids.size*100);
        if (currentProgress >= lastProgressStep + 10) {
            console.log(`   Progress: ${currentProgress}%`);
            lastProgressStep = Math.floor(currentProgress/10) * 10;
        }
    }
    
    console.log("✅ Leaderboard data stored in database");
    console.log("🎉 Data collection complete!");
    
    db.close();
} 