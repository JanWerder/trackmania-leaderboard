import { fetch } from "bun";
import { URL } from "url";

const groupId = process.env.groupid;
const memberFile = Bun.file(".users.json");
const memberMap = await memberFile.json();

/**
 * Retrieves the current year and month.
 *
 * @returns {Object} An object containing the current year and month.
 * @property {number} year - The current year.
 * @property {number} month - The current month (1-12).
 */
function getCurrentYearMonth() {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

/**
 * Parses the year and month from a given pathname.
 *
 * @param {string} pathname - The URL pathname to parse.
 * @returns {Object|null} An object containing the parsed year and month, or null if the pathname doesn't match.
 * @property {number} year - The parsed year.
 * @property {number} month - The parsed month (1-12).
 */
function parseYearMonth(pathname) {
    const match = pathname.match(/^\/(\d{4})\/(\d{2})$/);
    if (match) {
        const year = parseInt(match[1], 10);
        const month = parseInt(match[2], 10);
        if (!isNaN(year) && !isNaN(month) && month >= 1 && month <= 12) {
            return { year, month };
        }
    }
    return null;
}

/**
 * Calculates the previous month given a specific year and month.
 *
 * @param {number} year - The current year.
 * @param {number} month - The current month (1-12).
 * @returns {Object} An object containing the previous year and month.
 * @property {number} year - The previous year.
 * @property {number} month - The previous month (1-12).
 */
function getPreviousMonth(year, month) {
    if (month === 1) {
        return { year: year - 1, month: 12 };
    }
    return { year, month: month - 1 };
}

/**
 * Calculates the next month given a specific year and month.
 *
 * @param {number} year - The current year.
 * @param {number} month - The current month (1-12).
 * @returns {Object} An object containing the next year and month.
 * @property {number} year - The next year.
 * @property {number} month - The next month (1-12).
 */
function getNextMonth(year, month) {
    if (month === 12) {
        return { year: year + 1, month: 1 };
    }
    return { year, month: month + 1 };
}

/**
 * Formats a time duration from seconds to a human-readable string.
 *
 * @param {number|string} timeInSeconds - The time duration in seconds.
 * @returns {string} The formatted time string.
 *                    - If less than 60 seconds, returns seconds with three decimal places.
 *                    - If 60 seconds or more, returns a string in "MM:SS.SSS" format.
 */
function formatTime(timeInSeconds) {
    let seconds = parseFloat(timeInSeconds);
    if (seconds < 60) {
        return seconds.toFixed(3);
    } else {
        let minutes = Math.floor(seconds / 60);
        seconds = (seconds % 60).toFixed(3);
        return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(6, '0')}`;
    }
}

/**
 * Formats a month number to ensure it has two digits.
 *
 * @param {number} month - The month number (1-12).
 * @returns {string} The formatted month string with leading zero if necessary.
 */
function formatMonth(month) {
    return month.toString().padStart(2, '0');
}

/**
 * Retrieves the authentication token required for API requests.
 *
 * @async
 * @function
 * @returns {Promise<Object|Response>} A promise that resolves to an object containing the access token,
 *                                     or a Response object if rate-limited.
 * @property {string} accessToken - The authentication token.
 */
async function getAuthToken() {
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
    return { accessToken: data2.accessToken };
}

/**
 * Fetches and compiles leaderboard data for a complete month.
 *
 * @async
 * @function
 * @param {string} token - The authentication token.
 * @param {number} [length=1] - The number of months to retrieve.
 * @param {number} [offset=0] - The number of months to skip (looking backwards from the current month).
 * @param {boolean} [royal=false] - Whether to return maps for the Royal mode instead of TOTDs.
 * @returns {Promise<Array>} A promise that resolves to an array containing leaderboard data for each day of the month.
 */
async function getCompleteMonth(token, length = 1, offset = 0, royal = false) {
    const response1 = await fetch(`https://live-services.trackmania.nadeo.live/api/token/campaign/month?length=${length}&offset=${offset}&royal=${royal}`, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `nadeo_v1 t=${token}`,
            'User-Agent': 'Local Leaderboard'
        }
    });

    const data1 = await response1.json();
    const leaderboardPromises = data1.monthList[0].days.filter(day => day.mapUid !== "").map(day => {
        return fetch(`https://live-services.trackmania.nadeo.live/api/token/leaderboard/group/Personal_Best/map/${day.mapUid}/club/${groupId}/top?length=10&offset=0`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `nadeo_v1 t=${token}`,
                'User-Agent': 'Local Leaderboard'
            }
        }).then(response => response.json()).then(data2 => {
            const dayLeaderboard = data2.top?.map(entry => {
                const memberId = entry.accountId;
                const memberName = memberMap[memberId] || memberId;
                return { position: entry.position, name: memberName, score: entry.score / 1000 };
            }) || [];
            return { monthDay: day.monthDay, mapUid: day.mapUid, campaignId: day.campaignId, leaderboard: dayLeaderboard };
        });
    });

    const leaderboardResults = await Promise.all(leaderboardPromises);
    const leaderboard = [];
    leaderboardResults.forEach(result => {
        if (result.mapUid !== "") {
            leaderboard[result.monthDay - 1] = { monthDay: result.monthDay, mapUid: result.mapUid, leaderboard: result.leaderboard };
        }
    });

    const mapCommaList = leaderboard.map(day => day.mapUid).join(',');

    await fetch(`https://live-services.trackmania.nadeo.live/api/token/map/get-multiple?mapUidList=${mapCommaList}`, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `nadeo_v1 t=${token}`,
            'User-Agent': 'Local Leaderboard'
        }
    }).then(response => response.json()).then(data => {
        data.mapList.forEach(map => {
            const times = {
                gold: map.goldTime / 1000,
                silver: map.silverTime / 1000,
                bronze: map.bronzeTime / 1000,
                author: map.authorTime / 1000
            };
            const monthDay = leaderboard.find(e => e.mapUid == map.uid)?.monthDay;
            if (monthDay) {
                leaderboard[monthDay - 1].times = times;
                leaderboard[monthDay - 1].thumbnailUrl = map.thumbnailUrl;
            }
        });
    });

    leaderboard.forEach(day => {
        if (day && day.leaderboard) {
            day.leaderboard.forEach(entry => {
                if (entry.score <= day.times.author) {
                    entry.medal = "🏎️";
                } else if (entry.score <= day.times.gold) {
                    entry.medal = "🥇";
                } else if (entry.score <= day.times.silver) {
                    entry.medal = "🥈";
                } else if (entry.score <= day.times.bronze) {
                    entry.medal = "🥉";
                } else {
                    entry.medal = "💩";
                }
            });
        }
    });

    return leaderboard;
}

const server = Bun.serve({
    port: 3015,
    async fetch(request) {
        const url = new URL(request.url);
        const { pathname } = url;

        const ym = parseYearMonth(pathname);

        if (!ym) {
            const current = getCurrentYearMonth();
            const redirectUrl = `/${current.year}/${formatMonth(current.month)}`;
            return new Response(null, {
                status: 302,
                headers: {
                    "Location": redirectUrl
                }
            });
        }

        const { year, month } = ym;

        const tokenResponse = await getAuthToken();
        if (!tokenResponse.accessToken) {
            return tokenResponse;
        }

        const current = new Date();
        const desiredDate = new Date(year, month - 1);
        const monthsDifference = (current.getFullYear() - desiredDate.getFullYear()) * 12 + (current.getMonth() - desiredDate.getMonth());

        let allMonth;
        try {
            allMonth = await getCompleteMonth(tokenResponse.accessToken, 1, monthsDifference, false);
        } catch (error) {
            console.error("Error fetching complete month:", error);
            return new Response("Internal Server Error", { status: 500 });
        }

        let leaderboard = [];
        allMonth.forEach(day => {
            if (day && day.leaderboard) {
                day.leaderboard.forEach(entry => {
                    let player = leaderboard.find(player => player.name === entry.name);
                    if (!player) {
                        player = { name: entry.name, medalScore: 0, placeScore: 0, totalScore: 0 };
                        leaderboard.push(player);
                    }
                    if (entry.score <= day.times.author) {
                        player.medalScore += 4;
                    } else if (entry.score <= day.times.gold) {
                        player.medalScore += 3;
                    } else if (entry.score <= day.times.silver) {
                        player.medalScore += 2;
                    } else if (entry.score <= day.times.bronze) {
                        player.medalScore += 1;
                    }
                    player.placeScore += (3 - entry.position);
                });
            }
        });

        leaderboard.forEach(entry => {
            entry.totalScore = entry.medalScore + entry.placeScore;
        });

        leaderboard.sort((a, b) => b.totalScore - a.totalScore);

        const prev = getPreviousMonth(year, month);
        const next = getNextMonth(year, month);

        const prevUrl = `/${prev.year}/${formatMonth(prev.month)}`;
        const isCurrentMonth = (year === current.getFullYear()) && (month === (current.getMonth() + 1));
        const nextUrl = isCurrentMonth ? '#' : `/${next.year}/${formatMonth(next.month)}`;

        let page = `
        <html class="bg-slate-950">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Trackmania Leaderboard - ${year}/${formatMonth(month)}</title>
            <script src="https://cdn.tailwindcss.com"></script>
        </head>
        <body class="bg-transparent text-gray-100 font-sans">
            <div class="absolute bottom-0 left-[0%] right-0 top-[-10%] h-[500px] w-[500px] rounded-full bg-[radial-gradient(circle_farthest-side,rgba(255,0,182,.15),rgba(255,255,255,0))] pointer-events-none"></div>
            <div class="absolute bottom-0 right-[0%] top-[-10%] h-[500px] w-[500px] rounded-full bg-[radial-gradient(circle_farthest-side,rgba(255,0,182,.15),rgba(255,255,255,0))] pointer-events-none"></div>
            <div class="container w-full md:w-1/2 mx-auto px-4 py-8">
                <h1 class="text-4xl font-bold text-center text-blue-400 mb-8 flex justify-center items-center">
                    Trackmania Leaderboard - ${year}/${formatMonth(month)}
                    <a href="${prevUrl}" class="ml-4 text-2xl">⬅️</a>
                    ${
                        isCurrentMonth
                            ? `<span class="ml-2 text-2xl cursor-not-allowed opacity-50">➡️</span>`
                            : `<a href="${nextUrl}" class="ml-2 text-2xl">➡️</a>`
                    }
                </h1>

                <div class="bg-gray-800 shadow-lg rounded-lg overflow-hidden mb-8 md:w-1/2 mx-auto">
                    <table class="w-full table-auto">
                        <thead class="bg-blue-600 text-white">
                            <tr>
                                <th class="px-4 py-2">Name</th>
                                <th class="px-2 py-2">Medal Points</th>                                
                                <th class="px-2 py-2">Placement Points</th>
                                <th class="px-2 py-2">Combined Points</th>
                            </tr>
                        </thead>
                        <tbody>
                        ${(function fun() {
            let rows = "";
            leaderboard.forEach(entry => {
                rows += `<tr class="border-b border-gray-700">
                                <td class="px-4 py-2 text-center">${entry.name}</td>
                                <td class="px-2 py-2 text-center">${entry.medalScore}</td>                                    
                                <td class="px-2 py-2 text-center">${entry.placeScore}</td>
                                <td class="px-2 py-2 text-center font-bold">${entry.totalScore}</td>
                            </tr>
                            `;
            });
            return rows;
        })()}
                        </tbody>
                    </table>
                </div>

                <br/>

                <div class="bg-gray-800 shadow-lg rounded-lg overflow-hidden md:w-2/3 mx-auto">
                    <table class="w-full table-auto">
                        <thead class="bg-green-600 text-white">
                            <tr>
                                <th class="px-2 py-2 w-2">#</th>
                                <th class="px-2 py-2 text-left">Map Times</th>
                                <th class="px-2 py-2 text-left">Leaderboard</th>
                            </tr>
                        </thead>
                        <tbody>
                        ${(function fun() {
            let rows = "";
            allMonth.forEach(day => {
                if (day && day.leaderboard) {
                    let leaderboardHTML = `<table class="w-full table-auto">`;
                    day.leaderboard.forEach(entry => {
                        leaderboardHTML += `<tr>
                            <td><span class="w-6 h-6 mr-2 inline-flex items-center justify-center bg-blue-500 rounded-full text-xs font-bold">${entry.position}</span></td>
                            <td class="${entry.medal === '🥇' || entry.medal === '🏎️' ? 'font-bold' : ''}">${entry.name}</td>
                            <td class="${entry.medal === '🥇' || entry.medal === '🏎️' ? 'font-bold' : ''}">${formatTime(entry.score)}s</td>
                            <td> (${entry.medal})</td>
                        </tr>`;
                    });
                    leaderboardHTML += `</table>`;

                    let times = `<ul class="space-y-1">`;
                    times += `<li class="flex items-center"><span class="w-4 h-4 mr-2 inline-flex items-center justify-center bg-yellow-400 text-yellow-900 rounded-full text-xs font-bold">G</span>${day.times.gold}s</li>`;
                    times += `<li class="flex items-center"><span class="w-4 h-4 mr-2 inline-flex items-center justify-center bg-gray-300 text-gray-800 rounded-full text-xs font-bold">S</span>${day.times.silver}s</li>`;
                    times += `<li class="flex items-center"><span class="w-4 h-4 mr-2 inline-flex items-center justify-center bg-yellow-600 text-yellow-100 rounded-full text-xs font-bold">B</span>${day.times.bronze}s</li>`;
                    times += `</ul>`;

                    rows += `<tr class="border-b border-gray-700">
                                    <td class="px-2 py-2 w-1/4 text-center bg-clip-content bg-cover bg-contain bg-no-repeat bg-center text-2xl font-extrabold" style="background-image: url(${day.thumbnailUrl})">
                                        <span class="bg-clip-text text-transparent bg-white drop-shadow-[0_1.2px_1.2px_rgba(0,0,0,0.8)]">${day.monthDay}</span>
                                    </td>
                                    <td class="px-2 py-2 w-1/4 text-center">${times}</td>
                                    <td class="px-2 py-2 w-1/2 text-center">${leaderboardHTML}</td>    
                                </tr>
                                `;
                }
            });
            return rows;
        })()}
                        </tbody>
                    </table>
                </div>
            </div>    
        </body>
        </html>
        `;

        return new Response(page, {
            headers: {
                "Content-Type": "text/html; charset=utf-8",
            }
        });
    },
});