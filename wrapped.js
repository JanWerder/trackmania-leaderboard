import { Database } from 'bun:sqlite';

function getMedalCounts(db) {
    return db.prepare(`
        SELECT 
            user_id,
            SUM(CASE WHEN medal = '🥉' THEN 1 ELSE 0 END) as bronze_count,
            SUM(CASE WHEN medal = '🥈' THEN 1 ELSE 0 END) as silver_count,
            SUM(CASE WHEN medal = '🥇' THEN 1 ELSE 0 END) as gold_count,
            SUM(CASE WHEN medal = '🏎️' THEN 1 ELSE 0 END) as author_count,
            COUNT(*) as total_tracks
        FROM runs
        GROUP BY user_id
        ORDER BY author_count DESC, gold_count DESC, silver_count DESC, bronze_count DESC
    `).all();
}

function getAverageMedal(db) {
    return db.prepare(`
        SELECT 
            user_id,
            AVG(CASE 
                WHEN medal = '🏎️' THEN 4
                WHEN medal = '🥇' THEN 3
                WHEN medal = '🥈' THEN 2
                WHEN medal = '🥉' THEN 1
                ELSE 0 
            END) as avg_medal
        FROM runs
        GROUP BY user_id
        ORDER BY avg_medal DESC
    `).all();
}

function getEarliestSilver(db) {
    // First get all users who have at least one silver+ medal
    const users = db.prepare(`
        SELECT DISTINCT user_id 
        FROM runs 
        WHERE medal IN ('🥈', '🥇', '🏎️')
    `).all();

    // For each user, find their earliest silver+ medal
    const earliestMedals = users.map(user => {
        return db.prepare(`
            SELECT 
                r.user_id,
                r.medal,
                r.time,
                m.day,
                m.month,
                m.uid as map_uid,
                m.thumbnail_url
            FROM runs r
            JOIN maps m ON r.map_uid = m.uid
            WHERE r.user_id = ?
            AND r.medal IN ('🥈', '🥇', '🏎️')
            AND m.year = 2024
            ORDER BY m.month ASC, m.day ASC
            LIMIT 1
        `).get(user.user_id);
    }).filter(Boolean); // Remove any null results

    // Sort by month and day to get overall ranking
    return earliestMedals.sort((a, b) => {
        if (a.month !== b.month) {
            return a.month - b.month;
        }
        return a.day - b.day;
    }).slice(0, 3); // Get top 3
}

function getBestOutlier(db) {
    return db.prepare(`
        WITH map_stats AS (
            SELECT 
                map_uid,
                AVG(time) as avg_time,
                COUNT(*) as player_count
            FROM runs
            GROUP BY map_uid
            HAVING player_count = (SELECT COUNT(DISTINCT user_id) FROM runs)
        ),
        time_differences AS (
            SELECT 
                r.user_id,
                r.map_uid,
                r.time,
                m.thumbnail_url,
                m.day,
                m.month,
                ((ms.avg_time - r.time) / ms.avg_time * 100) as improvement_percent
            FROM runs r
            JOIN map_stats ms ON r.map_uid = ms.map_uid
            JOIN maps m ON r.map_uid = m.uid
        )
        SELECT 
            user_id,
            map_uid,
            time,
            thumbnail_url,
            day,
            month,
            improvement_percent
        FROM time_differences
        ORDER BY improvement_percent DESC
        LIMIT 3
    `).all();
}

function getCompletedMonths(db) {
    return db.prepare(`
        WITH monthly_maps AS (
            -- Get total maps per month
            SELECT month, COUNT(*) as total_maps
            FROM maps
            WHERE year = 2024
            GROUP BY month
        ),
        user_monthly_completions AS (
            -- Get completed maps per user per month
            SELECT 
                r.user_id,
                m.month,
                COUNT(*) as completed_maps
            FROM runs r
            JOIN maps m ON r.map_uid = m.uid
            WHERE m.year = 2024
            AND r.medal IN ('🥉', '🥈', '🥇', '🏎️')
            GROUP BY r.user_id, m.month
        )
        SELECT 
            umc.user_id,
            COUNT(*) as completed_months,
            GROUP_CONCAT(umc.month) as months_list
        FROM user_monthly_completions umc
        JOIN monthly_maps mm ON umc.month = mm.month
        WHERE umc.completed_maps >= mm.total_maps
        GROUP BY umc.user_id
        ORDER BY completed_months DESC
        LIMIT 3
    `).all();
}

function getCloseCalls(db) {
    return db.prepare(`
        WITH close_calls AS (
            SELECT 
                r.user_id,
                r.map_uid,
                r.time,
                r.medal,
                m.thumbnail_url,
                m.day,
                m.month,
                CASE 
                    WHEN r.medal = '🏎️' THEN ABS(r.time - m.author_time)
                    WHEN r.medal = '🥇' THEN ABS(r.time - m.gold_time)
                    WHEN r.medal = '🥈' THEN ABS(r.time - m.silver_time)
                    WHEN r.medal = '🥉' THEN ABS(r.time - m.bronze_time)
                END as time_diff
            FROM runs r
            JOIN maps m ON r.map_uid = m.uid
            WHERE r.medal != '💩'
            AND CASE 
                WHEN r.medal = '🏎️' THEN ABS(r.time - m.author_time)
                WHEN r.medal = '🥇' THEN ABS(r.time - m.gold_time)
                WHEN r.medal = '🥈' THEN ABS(r.time - m.silver_time)
                WHEN r.medal = '🥉' THEN ABS(r.time - m.bronze_time)
            END <= 100  -- Within 0.1 seconds (100 milliseconds)
        )
        SELECT 
            user_id,
            COUNT(*) as close_calls_count,
            GROUP_CONCAT(map_uid || '|' || medal || '|' || time_diff || '|' || thumbnail_url || '|' || day || '|' || month) as details
        FROM close_calls
        GROUP BY user_id
        ORDER BY close_calls_count DESC
        LIMIT 3
    `).all();
}

function getNarrowVictories(db) {
    return db.prepare(`
        WITH ranked_times AS (
            -- Get first and second place for each map
            SELECT 
                r1.map_uid,
                r1.user_id as winner_id,
                r1.time as winner_time,
                r1.medal as winner_medal,
                r2.time as second_time,
                m.thumbnail_url,
                m.day,
                m.month
            FROM runs r1
            JOIN runs r2 ON r1.map_uid = r2.map_uid AND r1.user_id != r2.user_id
            JOIN maps m ON r1.map_uid = m.uid
            WHERE r1.position = 1 
            AND r2.position = 2
            AND (r2.time - r1.time) <= 100  -- Within 100ms
            AND (r2.time - r1.time) > 0     -- Ensure positive difference
        )
        SELECT 
            winner_id as user_id,
            COUNT(*) as narrow_wins_count,
            GROUP_CONCAT(
                map_uid || '|' || 
                (second_time - winner_time) || '|' || 
                thumbnail_url || '|' || 
                day || '|' || 
                month || '|' ||
                winner_medal || '|' ||
                winner_time
            ) as details
        FROM ranked_times
        GROUP BY winner_id
        ORDER BY narrow_wins_count DESC
        LIMIT 3
    `).all();
}

function getLongestEndurance(db) {
    return db.prepare(`
        SELECT 
            user_id,
            map_uid,
            time,
            medal,
            thumbnail_url,
            day,
            month
        FROM runs
        JOIN maps m ON runs.map_uid = m.uid
        ORDER BY time DESC
        LIMIT 3
    `).all();
}

function formatTime(timeInSeconds) {
    let seconds = timeInSeconds / 1000;
    if (seconds < 60) {
        return seconds.toFixed(3) + 's';
    } else {
        let minutes = Math.floor(seconds / 60);
        seconds = (seconds % 60).toFixed(3);
        return `${minutes}:${seconds.padStart(6, '0')}`;
    }
}

export async function generateWrappedReport() {
    const db = new Database('trackmania_wrapped.db');
    const memberFile = Bun.file(".users.json");
    const memberMap = await memberFile.json();
    
    const awards = {
        medalCounts: getMedalCounts(db),
        averageMedal: getAverageMedal(db),
        earliestSilver: getEarliestSilver(db),
        bestOutlier: getBestOutlier(db),
        completedMonths: getCompletedMonths(db),
        closeCalls: getCloseCalls(db),
        narrowVictories: getNarrowVictories(db),
        longestEndurance: getLongestEndurance(db)
    };

    const html = `
        <!DOCTYPE html>
        <html class="bg-slate-950">
        <head>
            <title>Trackmania Wrapped 2024</title>
            <script src="https://cdn.tailwindcss.com"></script>
            <link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🏎️</text></svg>">
            <style>
                .animated-header {
                    font: 700 4em/1 "Oswald", sans-serif;
                    letter-spacing: 0;
                    padding: .25em 0 .325em;
                    display: block;
                    margin: 0 auto;
                    text-shadow: 0 0 80px rgba(255,255,255,.5);
                    background: url(https://i.ibb.co/RDTnNrT/animated-text-fill.png) repeat-y;
                    -webkit-background-clip: text;
                    background-clip: text;
                    -webkit-text-fill-color: transparent;
                    -webkit-animation: aitf 80s linear infinite;
                    -webkit-transform: translate3d(0,0,0);
                    -webkit-backface-visibility: hidden;
                }

                @-webkit-keyframes aitf {
                    0% { background-position: 0% 50%; }
                    100% { background-position: 100% 50%; }
                }

                .modal {
                    display: none;
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background-color: rgba(0, 0, 0, 0.9);
                    z-index: 1000;
                    cursor: pointer;
                }

                .modal img {
                    max-width: 90%;
                    max-height: 90vh;
                    margin: auto;
                    display: block;
                    position: relative;
                    top: 50%;
                    transform: translateY(-50%);
                }

                .track-thumbnail {
                    cursor: pointer;
                    transition: transform 0.2s;
                }

                .track-thumbnail:hover {
                    transform: scale(1.05);
                }
            </style>
        </head>
        <body class="bg-transparent text-gray-100 font-sans">
            <div id="imageModal" class="modal" onclick="closeModal()">
                <img id="modalImage" src="" alt="Enlarged track thumbnail">
            </div>
            <div class="absolute bottom-0 left-[0%] right-0 top-[-10%] h-[500px] w-[500px] rounded-full bg-[radial-gradient(circle_farthest-side,rgba(255,0,182,.15),rgba(255,255,255,0))]"></div>
            <div class="absolute bottom-0 right-[0%] top-[-10%] h-[500px] w-[500px] rounded-full bg-[radial-gradient(circle_farthest-side,rgba(255,0,182,.15),rgba(255,255,255,0))]"></div>
            
            <div class="container mx-auto px-4 py-8 relative">
                <h1 class="text-6xl font-bold text-center text-blue-400 mb-12 animated-header">Trackmania Wrapped 2024</h1>
                
                <!-- Medal Collection Section -->
                <section class="mb-16 bg-gray-800/50 rounded-xl p-8">
                    <h2 class="text-3xl font-bold mb-6 text-blue-300">🏆 Medal Collection</h2>
                    <p class="text-gray-400 mb-4">Total count of each medal type earned across all tracks.</p>
                    
                    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                        ${['author', 'gold', 'silver', 'bronze'].map(medalType => `
                            <div class="bg-gray-700/50 rounded-lg p-6">
                                <h3 class="text-xl font-bold mb-4">Most ${medalType} medals ${
                                    medalType === 'author' ? '🏎️' : 
                                    medalType === 'gold' ? '🥇' : 
                                    medalType === 'silver' ? '🥈' : '🥉'
                                }</h3>
                                <ol class="space-y-2">
                                    ${awards.medalCounts.slice(0, 3).map((user, index) => `
                                        <li class="flex justify-between items-center ${index === 0 ? 'text-yellow-400' : index === 1 ? 'text-gray-300' : 'text-yellow-600'}">
                                            <span>${memberMap[user.user_id]}</span>
                                            <span class="font-bold">${user[medalType + '_count']}</span>
                                        </li>
                                    `).join('')}
                                </ol>
                            </div>
                        `).join('')}
                    </div>
                </section>

                <!-- Track Completion Section -->
                <section class="mb-16 bg-gray-800/50 rounded-xl p-8">
                    <h2 class="text-3xl font-bold mb-6 text-blue-300">🎯 Track Completion</h2>
                    <p class="text-gray-400 mb-4">Total number of tracks completed with any medal.</p>
                    <div class="bg-gray-700/50 rounded-lg p-6">
                        <ol class="space-y-4">
                            ${awards.medalCounts.slice(0, 3).map((user, index) => `
                                <li class="flex justify-between items-center ${index === 0 ? 'text-yellow-400' : index === 1 ? 'text-gray-300' : 'text-yellow-600'}">
                                    <span class="text-xl">${index + 1}. ${memberMap[user.user_id]}</span>
                                    <span class="font-bold">${user.total_tracks} tracks</span>
                                </li>
                            `).join('')}
                        </ol>
                    </div>
                </section>

                <!-- Consistency Award Section -->
                <section class="mb-16 bg-gray-800/50 rounded-xl p-8">
                    <h2 class="text-3xl font-bold mb-6 text-blue-300">⭐ Best Average Medal</h2>
                    <p class="text-gray-400">Average medal is calculated by taking the average of the medal values for each track. 🏎️ is worth 4 points, 🥇 is worth 3 points, 🥈 is worth 2 points, and 🥉 is worth 1 point.</p>
                    <br />
                    <div class="bg-gray-700/50 rounded-lg p-6">
                        <ol class="space-y-4">
                            ${awards.averageMedal.slice(0, 3).map((user, index) => `
                                <li class="flex justify-between items-center ${index === 0 ? 'text-yellow-400' : index === 1 ? 'text-gray-300' : 'text-yellow-600'}">
                                    <span class="text-xl">${index + 1}. ${memberMap[user.user_id]}</span>
                                    <span class="font-bold">${user.avg_medal.toFixed(2)} avg</span>
                                </li>
                            `).join('')}
                        </ol>
                    </div>
                </section>

                <!-- Speed Demon Section -->
                <section class="mb-16 bg-gray-800/50 rounded-xl p-8">
                    <h2 class="text-3xl font-bold mb-6 text-blue-300">⚡ Earliest Silver+ Medal</h2>
                    <p class="text-gray-400 mb-4">First players to achieve a silver medal or better in 2024, ordered by month and day.</p>
                    <div class="bg-gray-700/50 rounded-lg p-6">
                        <ol class="space-y-4">
                            ${awards.earliestSilver.map((user, index) => `
                                <li class="flex justify-between items-center ${index === 0 ? 'text-yellow-400' : index === 1 ? 'text-gray-300' : 'text-yellow-600'}">
                                    <div class="flex items-center gap-4">
                                        <img src="${user.thumbnail_url}" class="w-16 h-16 rounded-lg object-cover track-thumbnail" />
                                        <div>
                                            <span class="text-xl">${index + 1}. ${memberMap[user.user_id]}</span>
                                            <div class="text-sm opacity-75">Track ${user.map_uid}</div>
                                        </div>
                                    </div>
                                    <div class="text-right">
                                        <div class="font-bold">Day ${user.day} of Month ${user.month}</div>
                                        <div class="text-sm opacity-75">${formatTime(user.time)} ${user.medal}</div>
                                    </div>
                                </li>
                            `).join('')}
                        </ol>
                    </div>
                </section>

                <!-- Best Outlier Section -->
                <section class="mb-16 bg-gray-800/50 rounded-xl p-8">
                    <h2 class="text-3xl font-bold mb-6 text-blue-300">💫 Greatest Outperformance</h2>
                    <p class="text-gray-400 mb-4">Tracks where players performed significantly better than the average time, showing percentage improvement compared to the mean.</p>
                    <div class="bg-gray-700/50 rounded-lg p-6">
                        <ol class="space-y-4">
                            ${awards.bestOutlier.map((user, index) => `
                                <li class="flex justify-between items-center ${index === 0 ? 'text-yellow-400' : index === 1 ? 'text-gray-300' : 'text-yellow-600'}">
                                    <div class="flex items-center gap-4">
                                        <img src="${user.thumbnail_url}" class="w-16 h-16 rounded-lg object-cover track-thumbnail" />
                                        <div>
                                            <span class="text-xl">${index + 1}. ${memberMap[user.user_id]}</span>
                                            <div class="text-sm opacity-75">Track ${user.map_uid}</div>
                                            <div class="text-sm opacity-75">Day ${user.day} of Month ${user.month}</div>
                                        </div>
                                    </div>
                                    <div class="text-right">
                                        <div class="font-bold">${user.improvement_percent.toFixed(1)}% faster</div>
                                        <div class="text-sm opacity-75">${formatTime(user.time)}</div>
                                    </div>
                                </li>
                            `).join('')}
                        </ol>
                    </div>
                </section>

                <!-- Completed Months Section -->
                <section class="mb-16 bg-gray-800/50 rounded-xl p-8">
                    <h2 class="text-3xl font-bold mb-6 text-blue-300">📅 Monthly Completionist</h2>
                    <p class="text-gray-400 mb-4">Players who completed all tracks in a month with at least a bronze medal.</p>
                    <div class="bg-gray-700/50 rounded-lg p-6">
                        <ol class="space-y-4">
                            ${awards.completedMonths.map((user, index) => `
                                <li class="flex justify-between items-center ${index === 0 ? 'text-yellow-400' : index === 1 ? 'text-gray-300' : 'text-yellow-600'}">
                                    <div>
                                        <span class="text-xl">${index + 1}. ${memberMap[user.user_id]}</span>
                                        <div class="text-sm opacity-75">Completed months: ${user.months_list.split(',').join(', ')}</div>
                                    </div>
                                    <span class="font-bold">${user.completed_months} month${user.completed_months !== 1 ? 's' : ''}</span>
                                </li>
                            `).join('')}
                        </ol>
                    </div>
                </section>

                <!-- Close Call Section -->
                <section class="mb-16 bg-gray-800/50 rounded-xl p-8">
                    <h2 class="text-3xl font-bold mb-6 text-blue-300">😅 Living on the Edge</h2>
                    <p class="text-gray-400 mb-4">Players who achieved medals with less than 0.1 seconds to spare.</p>
                    <div class="bg-gray-700/50 rounded-lg p-6">
                        <ol class="space-y-4">
                            ${awards.closeCalls.map((user, index) => {
                                // Get the closest call details
                                const details = user.details.split(',')[0].split('|');
                                const mapUid = details[0];
                                const medal = details[1];
                                const timeDiff = parseInt(details[2]) / 1000; // Convert to seconds
                                const thumbnailUrl = details[3];
                                const day = details[4];
                                const month = details[5];
                                
                                return `
                                    <li class="flex justify-between items-center ${index === 0 ? 'text-yellow-400' : index === 1 ? 'text-gray-300' : 'text-yellow-600'}">
                                        <div class="flex items-center gap-4">
                                            <img src="${thumbnailUrl}" class="w-16 h-16 rounded-lg object-cover track-thumbnail" />
                                            <div>
                                                <span class="text-xl">${index + 1}. ${memberMap[user.user_id]}</span>
                                                <div class="text-sm opacity-75">${user.close_calls_count} close call${user.close_calls_count !== 1 ? 's' : ''}</div>
                                                <div class="text-sm opacity-75">Closest: ${timeDiff.toFixed(3)}s to ${medal}</div>
                                                <div class="text-sm opacity-75">Day ${day} of Month ${month}</div>
                                            </div>
                                        </div>
                                        <div class="text-right">
                                            <div class="font-bold">Track ${mapUid}</div>
                                        </div>
                                    </li>
                                `;
                            }).join('')}
                        </ol>
                    </div>
                </section>

                <!-- Narrow Victory Section -->
                <section class="mb-16 bg-gray-800/50 rounded-xl p-8">
                    <h2 class="text-3xl font-bold mb-6 text-blue-300">😤 I Hate You So Much</h2>
                    <p class="text-gray-400 mb-4">Players who won by less than 0.1 seconds, crushing their opponents' dreams.</p>
                    <div class="bg-gray-700/50 rounded-lg p-6">
                        <ol class="space-y-4">
                            ${awards.narrowVictories.map((user, index) => {
                                // Get the most painful victory details
                                const details = user.details.split(',')[0].split('|');
                                const mapUid = details[0];
                                const timeDiff = parseInt(details[1]) / 1000; // Convert to seconds
                                const thumbnailUrl = details[2];
                                const day = details[3];
                                const month = details[4];
                                const medal = details[5];
                                const winningTime = parseInt(details[6]);
                                
                                return `
                                    <li class="flex justify-between items-center ${index === 0 ? 'text-yellow-400' : index === 1 ? 'text-gray-300' : 'text-yellow-600'}">
                                        <div class="flex items-center gap-4">
                                            <img src="${thumbnailUrl}" class="w-16 h-16 rounded-lg object-cover track-thumbnail" />
                                            <div>
                                                <span class="text-xl">${index + 1}. ${memberMap[user.user_id]}</span>
                                                <div class="text-sm opacity-75">${user.narrow_wins_count} cruel victor${user.narrow_wins_count !== 1 ? 'ies' : 'y'}</div>
                                                <div class="text-sm opacity-75">Closest win: ${timeDiff.toFixed(3)}s gap</div>
                                                <div class="text-sm opacity-75">Day ${day} of Month ${month}</div>
                                            </div>
                                        </div>
                                        <div class="text-right">
                                            <div class="font-bold">Track ${mapUid}</div>
                                            <div class="text-sm opacity-75">${formatTime(winningTime)} ${medal}</div>
                                        </div>
                                    </li>
                                `;
                            }).join('')}
                        </ol>
                    </div>
                </section>

                <!-- Longest Endurance Section -->
                <section class="mb-16 bg-gray-800/50 rounded-xl p-8">
                    <h2 class="text-3xl font-bold mb-6 text-blue-300">⏰ Longest Endurance</h2>
                    <p class="text-gray-400 mb-4">The longest time spent completing a single track, regardless of medal earned.</p>
                    <div class="bg-gray-700/50 rounded-lg p-6">
                        <ol class="space-y-4">
                            ${awards.longestEndurance.map((user, index) => `
                                <li class="flex justify-between items-center ${index === 0 ? 'text-yellow-400' : index === 1 ? 'text-gray-300' : 'text-yellow-600'}">
                                    <div class="flex items-center gap-4">
                                        <img src="${user.thumbnail_url}" class="w-16 h-16 rounded-lg object-cover track-thumbnail" />
                                        <div>
                                            <span class="text-xl">${index + 1}. ${memberMap[user.user_id]}</span>
                                            <div class="text-sm opacity-75">Track ${user.map_uid}</div>
                                            <div class="text-sm opacity-75">Day ${user.day} of Month ${user.month}</div>
                                        </div>
                                    </div>
                                    <div class="text-right">
                                        <div class="font-bold">${formatTime(user.time)} ${user.medal}</div>
                                    </div>
                                </li>
                            `).join('')}
                        </ol>
                    </div>
                </section>

                <section class="mb-16 rounded-xl p-8 text-center">
                    <h2 class="text-sm font-bold mb-6 text-blue-300">gg, better luck next year ~Jan</h2>
                </section>
            </div>
            <script>
                const modal = document.getElementById('imageModal');
                const modalImg = document.getElementById('modalImage');

                // Add click handlers to all track thumbnails
                document.querySelectorAll('.track-thumbnail').forEach(img => {
                    img.onclick = function() {
                        modal.style.display = "block";
                        modalImg.src = this.src;
                        event.stopPropagation();
                    }
                });

                function closeModal() {
                    modal.style.display = "none";
                }

                // Close modal when pressing escape key
                document.addEventListener('keydown', function(event) {
                    if (event.key === "Escape") {
                        closeModal();
                    }
                });
            </script>
        </body>
        </html>
    `;
    
    db.close();
    return html;
} 