<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <script src="https://cdnjs.cloudflare.com/ajax/libs/echarts/5.4.3/echarts.min.js"></script>
    <style>
        .altcoin-chart-container {
            width: 100%;
            max-width: 1200px;
            margin: 0 auto;
            background: linear-gradient(135deg, #1a1a1a 0%, #2a2a2a 100%);
            border-radius: 16px;
            padding: 24px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            color: white;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
        }
        
        .chart-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 24px;
            flex-wrap: wrap;
            gap: 16px;
        }
        
        .chart-title {
            font-size: 28px;
            font-weight: 700;
            color: white;
            margin: 0;
        }
        
        .current-value {
            font-size: 56px;
            font-weight: 300;
            color: #4ade80;
            text-shadow: 0 0 20px rgba(74, 222, 128, 0.3);
        }
        
        .season-bar {
            display: flex;
            height: 48px;
            border-radius: 12px;
            overflow: hidden;
            margin-bottom: 24px;
            position: relative;
            box-shadow: inset 0 2px 8px rgba(0, 0, 0, 0.3);
        }
        
        .bitcoin-season {
            background: linear-gradient(135deg, #f97316, #fb923c);
            flex: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-weight: 600;
            font-size: 16px;
            letter-spacing: 0.5px;
        }
        
        .altcoin-season {
            background: linear-gradient(135deg, #3b82f6, #6366f1);
            flex: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-weight: 600;
            font-size: 16px;
            letter-spacing: 0.5px;
        }
        
        .season-divider {
            width: 3px;
            background: linear-gradient(180deg, rgba(255,255,255,0.8), rgba(255,255,255,0.4));
            position: absolute;
            top: 0;
            bottom: 0;
            left: 50%;
            transform: translateX(-50%);
        }
        
        .chart-main {
            height: 400px;
            margin-bottom: 16px;
            border-radius: 8px;
            background: rgba(0, 0, 0, 0.2);
        }
        
        .chart-mini {
            height: 100px;
            border-radius: 8px;
            background: rgba(0, 0, 0, 0.2);
        }
        
        .legend {
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 20px 0;
            gap: 8px;
        }
        
        .legend-dot {
            width: 14px;
            height: 14px;
            background: #4ade80;
            border-radius: 3px;
            box-shadow: 0 0 8px rgba(74, 222, 128, 0.4);
        }
        
        .legend-text {
            color: #4ade80;
            font-weight: 600;
        }
        
        .loading-state {
            display: flex;
            align-items: center;
            justify-content: center;
            height: 400px;
            color: #9ca3af;
            font-size: 18px;
        }
        
        .error-state {
            display: flex;
            align-items: center;
            justify-content: center;
            height: 400px;
            color: #ef4444;
            font-size: 16px;
            text-align: center;
        }
        
        @keyframes pulse {
            0%, 100% { opacity: 0.6; }
            50% { opacity: 1; }
        }
        
        .loading-state {
            animation: pulse 2s ease-in-out infinite;
        }
        
        @media (max-width: 768px) {
            .altcoin-chart-container {
                padding: 16px;
            }
            
            .chart-title {
                font-size: 24px;
            }
            
            .current-value {
                font-size: 48px;
            }
            
            .chart-header {
                flex-direction: column;
                text-align: center;
            }
            
            .bitcoin-season, .altcoin-season {
                font-size: 14px;
            }
        }
    </style>
</head>
<body>
    <div class="altcoin-chart-container">
        <div class="chart-header">
            <h1 class="chart-title">Altcoin Season Index</h1>
            <div class="current-value" id="currentValue">--</div>
        </div>
        
        <div class="season-bar">
            <div class="bitcoin-season">Bitcoin Season</div>
            <div class="season-divider"></div>
            <div class="altcoin-season">Altcoin Season</div>
        </div>
        
        <div class="legend">
            <div class="legend-dot"></div>
            <span class="legend-text">Altcoin Season Index</span>
        </div>
        
        <div class="chart-main" id="mainChart">
            <div class="loading-state">Loading chart data...</div>
        </div>
        
        <div class="chart-mini" id="miniChart"></div>
    </div>

    <script>
        // Your actual backend endpoint
        const BACKEND_URL = 'https://whale-trades2.vercel.app/api/altcoin-season';
        
        let mainChart = null;
        let miniChart = null;
        
        // Sample fallback data in case API fails
        const fallbackData = [
            { timestamp: 1704067200000, altcoin_index: 45 },
            { timestamp: 1704153600000, altcoin_index: 42 },
            { timestamp: 1704240000000, altcoin_index: 38 },
            { timestamp: 1704326400000, altcoin_index: 35 },
            { timestamp: 1704412800000, altcoin_index: 32 },
            { timestamp: 1704499200000, altcoin_index: 28 },
            { timestamp: 1704585600000, altcoin_index: 25 },
            { timestamp: 1704672000000, altcoin_index: 22 },
            { timestamp: 1704758400000, altcoin_index: 28 },
            { timestamp: 1704844800000, altcoin_index: 32 },
            { timestamp: 1704931200000, altcoin_index: 35 },
            { timestamp: 1705017600000, altcoin_index: 39 },
            { timestamp: 1705104000000, altcoin_index: 42 },
            { timestamp: 1705190400000, altcoin_index: 45 },
            { timestamp: 1705276800000, altcoin_index: 48 },
            { timestamp: 1705363200000, altcoin_index: 52 },
            { timestamp: 1705449600000, altcoin_index: 55 },
            { timestamp: 1705536000000, altcoin_index: 58 },
            { timestamp: 1705622400000, altcoin_index: 62 },
            { timestamp: 1705708800000, altcoin_index: 65 },
            { timestamp: 1705795200000, altcoin_index: 68 },
            { timestamp: 1705881600000, altcoin_index: 72 },
            { timestamp: 1705968000000, altcoin_index: 75 },
            { timestamp: 1706054400000, altcoin_index: 72 },
            { timestamp: 1706140800000, altcoin_index: 68 },
            { timestamp: 1706227200000, altcoin_index: 65 },
            { timestamp: 1706313600000, altcoin_index: 62 },
            { timestamp: 1706400000000, altcoin_index: 58 },
            { timestamp: 1706486400000, altcoin_index: 55 },
            { timestamp: 1706572800000, altcoin_index: 52 }
        ];
        
        function formatDate(timestamp) {
            const date = new Date(timestamp);
            return date.toLocaleDateString('en-US', { 
                month: 'short', 
                day: 'numeric' 
            });
        }
        
        function prepareChartData(rawData) {
            return rawData.map(item => [
                // Handle both timestamp and date formats from your backend
                item.timestamp ? formatDate(item.timestamp) : item.date,
                item.altcoin_index
            ]);
        }
        
        function initializeCharts() {
            const mainChartEl = document.getElementById('mainChart');
            const miniChartEl = document.getElementById('miniChart');
            
            mainChart = echarts.init(mainChartEl);
            miniChart = echarts.init(miniChartEl);
        }
        
        function updateCharts(data) {
            const chartData = prepareChartData(data);
            const currentValue = data[data.length - 1]?.altcoin_index || 39;
            
            // Update current value display
            document.getElementById('currentValue').textContent = currentValue;
            
            const commonOption = {
                backgroundColor: 'transparent',
                grid: {
                    left: '3%',
                    right: '4%',
                    bottom: '3%',
                    top: '3%',
                    containLabel: true
                },
                xAxis: {
                    type: 'category',
                    boundaryGap: false,
                    axisLine: {
                        lineStyle: { color: '#4b5563' }
                    },
                    axisLabel: {
                        color: '#9ca3af',
                        fontSize: 11
                    },
                    splitLine: { show: false }
                },
                yAxis: {
                    type: 'value',
                    min: 0,
                    max: 110,
                    axisLine: { show: false },
                    axisLabel: {
                        color: '#9ca3af',
                        fontSize: 11,
                        formatter: '{value}'
                    },
                    splitLine: {
                        lineStyle: {
                            color: '#374151',
                            type: 'dashed'
                        }
                    }
                }
            };
            
            // Main chart
            const mainOption = {
                ...commonOption,
                tooltip: {
                    trigger: 'axis',
                    backgroundColor: 'rgba(0, 0, 0, 0.9)',
                    borderColor: '#4ade80',
                    borderWidth: 1,
                    textStyle: { color: '#fff' },
                    formatter: function(params) {
                        const point = params[0];
                        return `<div style="padding: 8px;">
                            <div style="color: #4ade80; font-weight: 600;">${point.name}</div>
                            <div>Index: ${point.value[1]}</div>
                            <div style="font-size: 12px; color: #9ca3af; margin-top: 4px;">
                                ${point.value[1] >= 75 ? 'Strong Altcoin Season' : 
                                  point.value[1] >= 50 ? 'Mild Altcoin Season' : 
                                  point.value[1] <= 25 ? 'Strong Bitcoin Season' : 'Bitcoin Season'}
                            </div>
                        </div>`;
                    }
                },
                series: [{
                    type: 'line',
                    data: chartData,
                    smooth: true,
                    symbol: 'none',
                    lineStyle: {
                        color: '#4ade80',
                        width: 3
                    },
                    areaStyle: {
                        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                            { offset: 0, color: 'rgba(74, 222, 128, 0.4)' },
                            { offset: 1, color: 'rgba(74, 222, 128, 0.05)' }
                        ])
                    }
                }]
            };
            
            // Mini chart (simplified)
            const miniOption = {
                ...commonOption,
                grid: {
                    left: '2%',
                    right: '2%',
                    bottom: '5%',
                    top: '5%',
                    containLabel: false
                },
                xAxis: {
                    ...commonOption.xAxis,
                    axisLabel: { show: false }
                },
                yAxis: {
                    ...commonOption.yAxis,
                    axisLabel: { show: false }
                },
                tooltip: { show: false },
                series: [{
                    type: 'line',
                    data: chartData,
                    smooth: true,
                    symbol: 'none',
                    lineStyle: {
                        color: '#60a5fa',
                        width: 2
                    },
                    areaStyle: {
                        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                            { offset: 0, color: 'rgba(96, 165, 250, 0.3)' },
                            { offset: 1, color: 'rgba(96, 165, 250, 0.05)' }
                        ])
                    }
                }]
            };
            
            mainChart.setOption(mainOption);
            miniChart.setOption(miniOption);
        }
        
        function showError(message) {
            const mainChartEl = document.getElementById('mainChart');
            mainChartEl.innerHTML = `<div class="error-state">${message}<br><br>Using fallback data for demonstration</div>`;
        }
        
        async function loadData() {
            try {
                const response = await fetch(BACKEND_URL);
                
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                
                const result = await response.json();
                
                if (result.error) {
                    throw new Error(result.message || result.error);
                }
                
                // Handle your backend's response format: { altcoinSeason: [...] }
                const data = result.altcoinSeason || result.data || result;
                
                if (!Array.isArray(data) || data.length === 0) {
                    throw new Error('No data received from API');
                }
                
                // Clear loading state
                document.getElementById('mainChart').innerHTML = '';
                document.getElementById('miniChart').innerHTML = '';
                
                initializeCharts();
                updateCharts(data);
                
            } catch (error) {
                console.error('Error loading data:', error);
                showError(`Failed to load live data: ${error.message}`);
                
                // Use fallback data
                setTimeout(() => {
                    document.getElementById('mainChart').innerHTML = '';
                    document.getElementById('miniChart').innerHTML = '';
                    initializeCharts();
                    updateCharts(fallbackData);
                }, 2000);
            }
        }
        
        // Handle window resize
        window.addEventListener('resize', function() {
            if (mainChart) mainChart.resize();
            if (miniChart) miniChart.resize();
        });
        
        // Initialize on page load
        document.addEventListener('DOMContentLoaded', function() {
            loadData();
        });
    </script>
</body>
</html>
