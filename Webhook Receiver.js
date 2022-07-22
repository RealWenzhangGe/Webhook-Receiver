class tradingPair {
    constructor(name, direction, entryPrice) {
        let account = _C(exchange.IO, "api", "GET", "/fapi/v2/account");
        let exchangeInfo = _C(exchange.IO, "api", "GET", "/fapi/v1/exchangeInfo");
        let leverageBracket = _C(exchange.IO, "api", "GET", "/fapi/v1/leverageBracket", "symbol=" + name);             
        
        let position = account.positions.filter((item) => (item.symbol.indexOf('USDT') != -1 && item.symbol.indexOf(name) != -1));
        let symbol = exchangeInfo.symbols.filter((item) => (item.symbol.indexOf(name) != -1));
        let quantityPrecision = Number(symbol[0].quantityPrecision);
        let level = leverageBracket[0].brackets.find(bracket => bracket.notionalCap / bracket.initialLeverage > account.availableBalance * 0.50).initialLeverage;
        
        this.name = name;
        this.level = level;
        this.direction = direction;
        this.positionAmount = Number(position[0].positionAmt);
        //this.stopPrice = (direction == 'buy') ? Number(entryPrice * 0.99).toFixed(quantityPrecision) : Number(entryPrice * 1.01).toFixed(quantityPrecision);
        this.unrealizedProfit = Number(position[0].unrealizedProfit);
        this.orderAmount = Number((account.availableBalance * 0.50 * level / entryPrice).toFixed(quantityPrecision));
    }
}

placeOrder = (name, direction, level, amount) => {
    _C(exchange.IO, "currency", name.slice(0, name.indexOf('USDT')) + '_' + name.slice(name.indexOf('USDT')));
    exchange.SetMarginLevel(level);
    
    if (direction == 'long') {
        exchange.SetDirection("buy");
        _C(exchange.Buy, -1, amount);
        Log("开了",amount,"个的",name,"多单");
        return true;
    } else if (direction == 'short') {
        exchange.SetDirection("sell");
        _C(exchange.Sell, -1, amount);
        Log("开了",amount,"个的",name,"空单");
        return true;
    } else if (direction == 'flat') {
        let account = _C(exchange.IO, "api", "GET", "/fapi/v2/account");
        let position = account.positions.filter((item) => (item.symbol == name));
        if (position) {
            closeOrder(name, position[0].positionAmt);
        }
        return true;
    } else {
        return false;
    }
}

closeOrder = (name, holdingAmount) => {
    exchange.IO("currency", name.slice(0, name.indexOf('USDT')) + '_' + name.slice(name.indexOf('USDT')));
    if (holdingAmount > 0) {
        exchange.SetDirection("closebuy");
        _C(exchange.Sell, -1, Math.abs(Number(holdingAmount)));
        Log("已平了",name,"的多单，狠狠地润！");
        return true;
    } else if (holdingAmount < 0) {
        exchange.SetDirection("closesell");
        _C(exchange.Buy, -1, Math.abs(Number(holdingAmount)));
        Log("已平了",name,"的空单，狠狠地润！");
        return true;
    } else if (holdingAmount == 0) {
        return true;
    } else {
        return false;
    }
}

latestPrice = (period, symbol) => {    
    let url = "https://fapi.binance.com/fapi/v1/klines?symbol=" + symbol + "&interval=" + period;
    let ret = _C(HttpQuery, url);

    Sleep(100);
    
    get = (ret) => {        
        let jsonData = JSON.parse(ret);
        let records = [];
        for (let i = 0; i < jsonData.length; i++) {
            records.push({
                Time: jsonData[i][0],
                Open: Number(jsonData[i][1]),
                High: Number(jsonData[i][2]),
                Low: Number(jsonData[i][3]),
                Close: Number(jsonData[i][4]),
                Volume: Number(jsonData[i][5]),
            });
        }
        return records;
    }

    try {
        let records = get(ret);
        return records[records.length - 1].Close;
    } catch (e) {
        Log(e);
    }        
}

function main() {
    let winning = 0;
    let failure = 0;
    let profit = 0;
    let loss = 0;
    let netWorth = 0;
    exchange.SetContractType("swap"); //永续合约
    exchange.IO("cross", true); //切换为全仓
    while (true) {
        let cmd = GetCommand();
        if (cmd) {
            Log('已接收到Tradingview发出的Webhook信号，准备行动');
            const command = cmd.split(",");
            Log('信号为：',command);
            let pair = new tradingPair(command[0].slice(0, command[0].indexOf('PERP')), command[1], Number(command[2]));

            if (pair.positionAmount == 0 && pair.orderAmount != 0 && placeOrder(pair.name, pair.direction, pair.level, pair.orderAmount)) {
                Log('开单完毕，请等待');
            } else if (pair.positionAmount != 0 && closeOrder(pair.name, pair.positionAmount)) {
                let unrealizedProfit = pair.unrealizedProfit;
                netWorth += unrealizedProfit;
                if (unrealizedProfit > 0) {
                    winning++;
                    profit += unrealizedProfit;
                    Log('哈哈，赚钱啦！收了', unrealizedProfit, '个USDT');
                } else {
                    failure++;
                    loss += Math.abs(unrealizedProfit);
                    Log('亏钱了！亏了', Math.abs(unrealizedProfit), '个USDT');
                }
                Log('当前策略净值为', netWorth, 'USDT', '盈亏比为', profit / loss, '胜率为', winning / (winning + failure) * 100, "%" );

                pair = new tradingPair(command[0].slice(0, command[0].indexOf('PERP')), command[1], Number(command[2]));
                if (pair.positionAmount == 0 && placeOrder(pair.name, pair.direction, pair.level, pair.orderAmount)) {
                    Log('开单完毕，请等待');
                }
            }
        } /*  else { //检查止损
            let account = exchange.IO("api", "GET", "/fapi/v2/account");
            let position = account.positions.filter((item) => (item.entryPrice != 0 && item.unrealizedProfit < 0));
            if (position) {
                let length = position.length;
                for (let i = 0; i < length; i++) {
                    if (position[i].positionAmt > 0 && latestPrice('1m', position[i].symbol) < position[i].entryPrice * 0.99073 && closeOrder(position[i].symbol, position[i].positionAmt)) {
                    let unrealizedProfit = position[i].unrealizedProfit;
                    netWorth += unrealizedProfit;
                    failure++;
                    loss += Math.abs(unrealizedProfit);
                } else if (position[i].positionAmt < 0 && latestPrice('1m', position[i].symbol) > position[i].entryPrice * 1.00927 && closeOrder(position[i].symbol, position[i].positionAmt)) {
                    let unrealizedProfit = position[i].unrealizedProfit;
                    netWorth += unrealizedProfit;
                    failure++;
                    loss += Math.abs(unrealizedProfit);
                }
            }
        } 
    } */
    Sleep(100);
}
}
