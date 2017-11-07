var express = require('express');
var router = express.Router();
var math = require('mathjs');
const WebSocket = require('ws');
const gdax = require('gdax');

const PRODUCT_LIST = ['BTC-USD', 'ETH-USD', 'LTC-USD', 'ETH-BTC', 'LTC-BTC'];

const VAR_MAP = {
  'BTC-USD': {Tag: 'BTC-USD', Ask: 10, Bid: 01, highestAsk: 999999999, lowestBid: 0, Vol: [], Decimals: 2, Tick: 0.01},
  'ETH-USD': {Tag: 'ETH-USD', Ask: 10, Bid: 01, highestAsk: 999999999, lowestBid: 0, Vol: [], Decimals: 2, Tick: 0.01},
  'LTC-USD': {Tag: 'LTC-USD', Ask: 10, Bid: 01, highestAsk: 999999999, lowestBid: 0, Vol: [], Decimals: 2, Tick: 0.01},
  'ETH-BTC': {Tag: 'ETH-BTC', Ask: 10, Bid: 01, highestAsk: 999999999, lowestBid: 0, Vol: [], Decimals: 5, Tick: 0.00001},
  'LTC-BTC': {Tag: 'LTC-BTC', Ask: 10, Bid: 01, highestAsk: 999999999, lowestBid: 0, Vol: [], Decimals: 5, Tick: 0.00001},
};

var usdBalance = 0;
var btcBalance = 0;
var ethBalance = 0;
var ltcBalance = 0;

var sellOrders = {};
var buyOrders = {};

var margin, ltcMargin, profit, ltcProfit, targetExchange, ltcTargetExchange;
var targetExchangeBack, ltcTargetExchangeBack, marginBack, ltcMarginBack, profitBack, ltcProfitBack;
var product;
var sequenceNum = 0;
var latestFillId = 3000;

var btcBuyPrice = undefined;
var ethBuyPrice = undefined;
var ltcBuyPrice = undefined;

const ws = new WebSocket('wss://ws-feed.gdax.com');

const passphrase = process.argv[2];
const secret = process.argv[3];
const key = process.argv[4];
const apiURI = 'https://api.gdax.com';
const authedClient = new gdax.AuthenticatedClient(key, secret, passphrase, apiURI);

var trade_countdown = 5;
const NO_TRADE = 0;
const BTC_ETH = 1;
const ETH_BTC = 2;
const BTC_LTC = 3;
const LTC_BTC = 4;
const BTC_TO_ETH_MARGIN = 0.0010;
const ETH_TO_BTC_MARGIN = -0.0072;

const MIN_BALANCE_USD = 5.00;
const MIN_BALANCE_CRYPTO = 0.01;
var trade_flag = NO_TRADE;
var buffer_flag = 0;
const BUFFER = 0.0005;

var balanceLog = "";

const subMsg = {
  "type": "subscribe",
  "product_ids": PRODUCT_LIST,
  "channels": [
  "level2"
  ]
}

var cancelAllTimeout = [-1, 0];
var getAllFillsIntervalCode;
const PROCESS_FILLS_INTERVAL = 2222;

//TODO
// better detect when orders are filled

/* GET home page. */
router.get('/', function(req, res, next) {

  ws.on('open', function open() {
    ws.send(JSON.stringify(subMsg));
    setTimeout(() => {
      ws.send(JSON.stringify(subMsg));
    }, 2000);
  });

  ws.on('message', function incoming(data) {
    data = JSON.parse(data);
    if (data['type'] === 'subscriptions') {
      checkSubscriptions(data["channels"][0]["product_ids"].toString().split(','));
    } else if (data['type'] === 'snapshot') {
      updateSnapshot(data, VAR_MAP[data['product_id']]);
    } else if (data['type'] === 'l2update') {
      updateChanges(data['changes'], VAR_MAP[data['product_id']]);
    }
  });
  ws.on('error', function incoming(err) {
    logBig(err);
  });
  generatePage(req, function(results) { res.render('index', results)}); 

  authedClient.getAccounts((error, response, data) => {
    if (error || isNull(data)) {

    } else {
      log("Loaded accounts: ");
      log(data);
      updateAccounts(data);
    }
  });
  setTimeout(() => {
    setInterval(() => {
      authedClient.getAccounts((error, response, data) => {
        if (error || isNull(data)) {

        } else {
          updateAccounts(data);
        }
      })}, 2500);
  }, 1000);

  authedClient.getOrders((error, response, data) => {
    if (error || isNull(data)) {

    } else {
      log("Loaded orders: ");
      log(data);
      loadOrders(data);
    }
  });
  setInterval(() => {
    authedClient.getOrders((error, response, data) => {
      if (error || isNull(data)) {

      } else {
        if (data.length > 0) {
          log("Updating orders: ");
          log(data);
        }
        loadOrders(data);
      }
    })}, 2500);

  getAllFillsIntervalCode = setInterval(() => {
    authedClient.getFills({'before': latestFillId}, (error, response, data) => {
      if (error || isNull(data)) {

      } else {
        processFills(data);
      }
    })
  }, 333);

  var timer = setInterval(() => {
    if (!isNull(getAllFillsIntervalCode) || trade_countdown > 0) {
      log("Loading...");
      trade_countdown--;
    } else {
      trade_countdown = 0;
      trade_flag = 0;
      clearInterval(timer);
    }
  }, 1000);

  setInterval(() => {
    log(". " + trade_flag);
  }, 10000);

  setInterval(() => {
    logBalance();
  }, 120000);
  
});


router.get('/reload', function(req, res) {
  generatePage(req, function(results) {
    res.render('page', results);
  });
});

function logBalance() {
  if (trade_flag == NO_TRADE) {
    balanceLog = balanceLog + (new Date()) + " - " + (usdBalance + 
      (btcBalance * parseFloat(VAR_MAP['BTC-USD'].Ask)) + 
      (ethBalance * parseFloat(VAR_MAP['ETH-USD'].Ask)) +
      (ltcBalance * parseFloat(VAR_MAP['LTC-USD'].Ask))).toFixed(2) + " " ;
  }
}

function startFillsListener() {
  logBig("Starting fills listener.");
  getAllFillsIntervalCode = null;
  setInterval(() => {
    authedClient.getFills({'before': latestFillId}, (error, response, data) => {
      if (error || isNull(data)) {

      } else {
        processFills(data);
      }
    })
  }, PROCESS_FILLS_INTERVAL);
}

function sellOrder(product_id, price, size) {
  var sellParams = {
    'price': price,
    'size': size,
    'product_id': product_id,
    'post_only': true,
  };
  if (trade_countdown == 0) {
    if (price > VAR_MAP[product_id].Ask) {
      price = VAR_MAP[product_id].Ask;
    }
    logBig("Selling " + size + " " + product_id + " for " + price + 
      "\nCurrent budgets: USD " + usdBalance + ", BTC " + btcBalance + ", ETH " + ethBalance);
    authedClient.sell(sellParams, function(error, response, data){
      onSell(error, response, data, product_id, price, size);
    });
  }
}

function onSell(error, response, data, product_id, price, size) {
  if (error || isNull(data) || !isNull(data['message'])) {
    logBig(data);
    switch(product_id) {
      case 'BTC-USD':
      btcBalance += price * size;
      break;
      case 'ETH-USD':
      ethBalance += price * size;
      break;
      case 'ETH-BTC':
      ethBalance += price * size;
      break;
      default:
      break;
    }
  } else {
    log(data);
    sellOrders[data['id']] = [product_id, price, size];
  }
}

function buyOrder(product_id, price, size) {
  var buyParams = {
    'price': price,
    'size': size,
    'product_id': product_id,
    'post_only': true,
  };
  if (trade_countdown == 0) {    
    if (price < VAR_MAP[product_id].Bid) {
      var budget = size * price;
      price = VAR_MAP[product_id].Bid;
      size = (budget/price).toFixed(8);
    }
    logBig("Buying " + size + " " + product_id + " for " + price + 
      "\nCurrent budgets: USD " + usdBalance + ", BTC " + btcBalance + ", ETH " + ethBalance);

    authedClient.buy(buyParams, function(error, response, data) {
      onBuy(error, response, data, product_id, price, size);
    });
  }
}

function onBuy(error, response, data, product_id, price, size) {
  if (error || isNull(data) || !isNull(data['message'])) {
    logBig(data);
    switch(product_id) {
      case 'BTC-USD':
      usdBalance += price * size;
      break;
      case 'ETH-USD':
      usdBalance += price * size;
      break;
      case 'ETH-BTC':
      btcBalance += price * size;
      break;
      default:
      break;
    }
  } else {
    log(data);
    log(data['id']);
    buyOrders[data['id']] = [product_id, price, size];
  }
}

function cancelOrder(orderId, cb) {
  if (trade_countdown == 0) {
    logBig("canceling: " + orderId);
    authedClient.cancelOrder(orderId, function(error, response, data) {
      onCancel(error, response, data, orderId, cb);
    });
  }
}

function onCancel(error, response, data, orderId, cb) {
  if (error || isNull(data)) {

  } else {
    if (isNull(data['message']) || data['message'] === "Order already done") {
      logBig("Canceled " + orderId);
      if (orderId in sellOrders) {
        delete sellOrders[orderId];
      } else if (orderId in buyOrders) {
        delete buyOrders[orderId];
      }
      if (cb) {
        cb();
      }
    } else {
      log(data['message']);
    }
  }
}

function updateOrders(orderList, product_id, oldPrice, newPrice, buy) {
  if (trade_flag != NO_TRADE) {
    log("Update called on " + product_id + " " + oldPrice + " " + newPrice);
    log(orderList);
  }
  for (var id in orderList) {
    var order = orderList[id];
    if (order[0] === product_id && ((buy && parseFloat(order[1]) < newPrice) || (!buy && parseFloat(order[1]) > newPrice))) {
      // cancel existing order
      cancelOrder(id, function() {
        var totalCurrency = order[2] * order[1];

        // put new order at new price
        if (buy) {
          buyOrder(product_id, newPrice, ((totalCurrency/newPrice) - 0.00001).toFixed(8));
        } else {
          sellOrder(product_id, newPrice, ((totalCurrency/newPrice) - 0.00001).toFixed(8));
        }
      });
    }
  }
}

function startTrades() {
  if (trade_flag == NO_TRADE) {
    return;
  } else if (trade_flag == BTC_ETH) {
    if (((usdBalance - MIN_BALANCE_USD)/VAR_MAP['BTC-USD'].Bid).toFixed(8) > 0.01) {
      // buy btc
      buyOrder('BTC-USD', VAR_MAP['BTC-USD'].Bid, ((usdBalance - MIN_BALANCE_USD)/VAR_MAP['BTC-USD'].Bid).toFixed(8));
      usdBalance = MIN_BALANCE_USD;
    }
    if (((btcBalance - MIN_BALANCE_CRYPTO)/VAR_MAP['ETH-BTC'].Bid).toFixed(8) > 0.01) {
      // convert to eth
      buyOrder('ETH-BTC', VAR_MAP['ETH-BTC'].Bid, ((btcBalance - MIN_BALANCE_CRYPTO)/VAR_MAP['ETH-BTC'].Bid).toFixed(8));
      btcBalance = MIN_BALANCE_CRYPTO;
    }
    if ((ethBalance - MIN_BALANCE_CRYPTO).toFixed(8) > 0.01) {
      // sell eth
      sellOrder('ETH-USD', VAR_MAP['ETH-USD'].Ask, (ethBalance - MIN_BALANCE_CRYPTO).toFixed(8));
      ethBalance = MIN_BALANCE_CRYPTO;
    }
  } else if (trade_flag == ETH_BTC) {
    if (((usdBalance - MIN_BALANCE_USD)/VAR_MAP['ETH-USD'].Bid).toFixed(8) > 0.01) {
      // buy eth
      buyOrder('ETH-USD', VAR_MAP['ETH-USD'].Bid, ((usdBalance - MIN_BALANCE_USD)/VAR_MAP['ETH-USD'].Bid).toFixed(8));
      usdBalance = MIN_BALANCE_USD;
    }
    if ((ethBalance - MIN_BALANCE_CRYPTO).toFixed(8) > 0.01) {
      // convert to btc
      sellOrder('ETH-BTC', VAR_MAP['ETH-BTC'].Ask, (ethBalance - MIN_BALANCE_CRYPTO).toFixed(8));
      ethBalance = MIN_BALANCE_CRYPTO;
    }
    if ((btcBalance - MIN_BALANCE_CRYPTO).toFixed(8) > 0.01) {
      // sell btc
      sellOrder('BTC-USD', VAR_MAP['BTC-USD'].Ask, (btcBalance - MIN_BALANCE_CRYPTO).toFixed(8));
      btcBalance = MIN_BALANCE_CRYPTO;
    }
  }
}

function cancelOutstandingOrders(cb) {
  if (trade_countdown == 0) {
    logBig("Cancelling all orders...");
    authedClient.cancelAllOrders(function(error, response, data) {
      if (error || isNull(data)) {
        logBig("Error cancelling: " + error);
      } else {
        if (data.length > 0) {
          for(var i = 0; i < data.length; i++) {
            onCancel(error, response, data, data[i]);
          }
        }
        if (cb) {
          cb();
        }
      }
    });
  }
}

function processFills(data) {
  if (data.length > 0) {
    log("New fills: " + data.length);
    // log(data);
  } else if (!isNull(getAllFillsIntervalCode)) {
    clearInterval(getAllFillsIntervalCode);
    startFillsListener();
  }
  for (var i = 0; i < data.length; i++) {
    var fill = data[i];
    var order = null;
    latestFillId = math.max(fill['trade_id'], latestFillId);
    if (fill['order_id'] in sellOrders) {
      order = sellOrders[fill['order_id']];
    } else if (fill['order_id'] in buyOrders) {
      order = buyOrders[fill['order_id']];
    }
    if (order != null && fill['settled']) {
      if (order[0] === fill['product_id'] && order[1] == fill['price']) {
        var newQuantity = order[2] - fill['size'];
        if (math.round(newQuantity, 6) == 0) {
          // Remove order
          if (fill['order_id'] in sellOrders) {
            delete sellOrders[fill['order_id']];
          } else if (fill['order_id'] in buyOrders) {
            delete buyOrders[fill['order_id']];
          }
        } else {
          // Update order
          var newOrder = [order[0], order[1], newQuantity];
          if (fill['order_id'] in sellOrders) {
            sellOrders[fill['order_id']] = newOrder;
          } else if (fill['order_id'] in buyOrders) {
            buyOrders[fill['order_id']] = newOrder;
          }
        }
        // Credit order currency
        switch(fill['product_id']) {
          case 'BTC-USD':
          if(fill['side'] === 'buy') {
            btcBalance += fill['size'] * fill['price'];
          } else {
            usdBalance += fill['size'] * fill['price'];
          }
          break;
          case 'ETH-USD':
          if(fill['side'] === 'buy') {
            ethBalance += fill['size'] * fill['price'];
          } else {
            usdBalance += fill['size'] * fill['price'];
          }
          break;
          case 'ETH-BTC':
          if(fill['side'] === 'buy') {
            ethBalance += fill['size'] * fill['price'];
          } else {
            btcBalance += fill['size'] * fill['price'];
          }
          break;
          default:
          break;
        }
      }
    }
  }
}

function loadOrders(data) {
  // Memory issues maybe?
  sellOrders = {};
  buyOrders = {};
  for (var i = 0; i < data.length; i++) {
    if(data[i]['side'] === 'sell') {
      var order = [data[i]['product_id'], 
      parseFloat(data[i]['price']).toFixed(data[i]['product_id'] === 'ETH-BTC' ? 5 : 2), 
      parseFloat(data[i]['size']).toFixed(8)];
      sellOrders[data[i]['id']] = order;
      if (order[1] > VAR_MAP[order[0]].Ask) {
        //remove old order
        //update new order
        updateOrders(sellOrders, data[i]['product_id'], order[1], VAR_MAP[order[0]].Ask, false);
      }

    } else {
      var order = [data[i]['product_id'], 
      parseFloat(data[i]['price']).toFixed(data[i]['product_id'] == 'ETH-BTC' ? 5 : 2), 
      parseFloat(data[i]['size']).toFixed(8)];
      buyOrders[data[i]['id']] = order;
      if (order[1] < VAR_MAP[order[0].Bid]) {
        // remove old order
        // update new order
        updateOrders(buyOrders, data[i]['product_id'], order[1], VAR_MAP[order[0]].Bid, true);
      }
    }
  }
}

function updateAccounts(data) {
  var oldUsdBalance = usdBalance;
  var oldBtcBalance = btcBalance;
  var oldEthBalance = ethBalance;
  var oldLtcBalance = ltcBalance;
  for (var i = 0; i < data.length; i++) {
    switch(data[i]['currency']) {
      case 'USD':
      usdBalance = parseFloat(data[i]['available']);
      break;
      case 'BTC':
      btcBalance = parseFloat(data[i]['available']);
      break;
      case 'ETH':
      ethBalance = parseFloat(data[i]['available']);
      break;
      case 'LTC':
      ltcBalance = parseFloat(data[i]['available']);
      break;
      default:
      break;
    }
  }
  if (oldUsdBalance != usdBalance || oldBtcBalance != btcBalance || oldEthBalance != ethBalance || oldLtcBalance != ltcBalance) {
    log("Account balances: ");
    log("USD: " + usdBalance);
    log("BTC: " + btcBalance);
    log("ETH: " + ethBalance);
    log("LTC: " + ltcBalance);
    trade_flag = findTradeFlag();
    startTrades(trade_flag);
  }
}

function updateSnapshot(data, product) {
  bids = data['bids'];
  asks = data['asks'];
  if (parseFloat(bids[0][0]) > product.Bid) {
    // update orders
    updateOrders(buyOrders, product.Tag, product.Bid, parseFloat(bids[0][0]), true);
  }
  if (parseFloat(asks[0][0]) < product.Ask) {
    // update orders
    updateOrders(sellOrders, product.Tag, product.Ask, parseFloat(asks[0][0]), false);
  }
  product.Bid = parseFloat(bids[0][0]);
  product.lowestBid = parseFloat(bids[bids.length-1][0]);
  product.Ask = parseFloat(asks[0][0]);
  product.highestAsk = parseFloat(asks[asks.length-1][0]);
  bids.forEach(function(element) {
    product.Vol[parseFloat(element[0])] = parseFloat(element[1]);
  });
  asks.forEach(function(element) {
    product.Vol[parseFloat(element[0])] = parseFloat(element[1]);
  });
}

function updateChanges(changes, product) {
  //todo detect change on other side
  changes.forEach(function(change) {
    var price = parseFloat(change[1]);
    var vol = parseFloat(change[2]);
    if (change[0] === "buy") {
      if (vol == 0) {
        product.Vol[price] = undefined;
        if (price == product.Bid) {
          // find next highest bid
          if (Object.keys(sellOrders).length > 0) {
            updateOrders(sellOrders, product.Tag, product.Ask, price, false);
          }
          product.Bid = findNextHighest(product.Bid, product.lowestBid, product.Vol, product.Tick, product.Decimals);
        } 
        if (price == product.lowestBid) {
          // find next lowest bid
          product.lowestBid = findNextLowest(product.lowestBid, product.Bid, product.Vol, product.Tick, product.Decimals);
        }
      } else if (vol > 0) {
        product.Vol[price] = vol;
        if (price > product.Bid) {
          // Update existing orders
          if (Object.keys(buyOrders).length > 0) {
            updateOrders(buyOrders, product.Tag, product.Bid, price, true);
          }
          product.Bid = price;
        }
        if (price < product.lowestBid) {
          product.lowestBid = price;
        }
      }
    } else if (change[0] === "sell") {
      if (vol == 0) {
        product.Vol[price] = undefined;
        if (price == product.Ask) {
          // find next lowest ask
          if (Object.keys(buyOrders).length > 0) {
            updateOrders(buyOrders, product.Tag, product.Bid, price, true);
          }
          product.Ask = findNextLowest(product.Ask, product.highestAsk, product.Vol, product.Tick, product.Decimals);
        }
        if (price == product.highestAsk) {
          // find next highest ask
          product.highestAsk = findNextHighest(product.highestAsk, product.Ask, product.Vol, product.Tick, product.Decimals);
        }
      } else if (vol > 0) {
        product.Vol[price] = vol;
        if (price < product.Ask) {
          // Update existing orders
          if (Object.keys(sellOrders).length > 0) {
            updateOrders(sellOrders, product.Tag, product.Ask, price, false);
          }
          product.Ask = price;
        }
        if (price > product.highestAsk) {
          product.highestAsk = price;
        }
      }
    }
  });
}

function findNextLowest(price, highest, vol, tick, decimals) {
  while (price < highest) {
    price = math.round(price + tick, decimals);
    if (vol[price] !== undefined && vol[price] !== 0) {
      return price;
    }
  }
  return price;
}

function findNextHighest(price, lowest, vol, tick, decimals) {
  while (price > lowest) {
    price = math.round(price - tick, decimals);
    if (vol[price] !== undefined && vol[price] !== 0) {
      return price;
    }
  }
  return price;
}

function checkSubscriptions(subscriptions) {
  if (subscriptions.length == PRODUCT_LIST.length) {
    log("Verified subscriptions: " + subscriptions);
  } else {
    logBig("Missing subscriptions. Currently: " + subscriptions + " " + subscriptions.length);
    setTimeout(() => {
      ws.send(JSON.stringify(subMsg));  
    }, 2000)
  }
}

function isNull(obj) {
  return !(obj && obj !== 'null' && obj !== 'undefined');
}

function generatePage(req, cb) {
  var btc = VAR_MAP['BTC-USD'];
  var eth = VAR_MAP['ETH-USD'];
  var ltc = VAR_MAP['LTC-USD'];
  var exchange = VAR_MAP['ETH-BTC'];
  var ltcExchange = VAR_MAP['LTC-BTC'];

  var btcBid = btcBuyPrice != undefined ? btcBuyPrice : btc.Bid;
  var ethBid = ethBuyPrice != undefined ? ethBuyPrice : eth.Bid;
  var ltcBid = ltcBuyPrice != undefined ? ltcBuyPrice : ltc.Bid;

  ltcTargetExchange = parseFloat(ltc.Ask/btcBid);
  ltcTargetExchangeBack = parseFloat(ltcBid/btc.Ask);
  targetExchange = parseFloat(eth.Ask/btcBid);
  targetExchangeBack = parseFloat(ethBid/btc.Ask);

  margin = targetExchange/parseFloat(exchange.Bid);
  marginBack = targetExchangeBack/parseFloat(exchange.Ask);
  var trade = shouldTrade(margin, marginBack, 'ETH');
  profit = ((margin - 1) * 100).toFixed(5);
  profitBack = ((marginBack - 1) * 100).toFixed(5);

  ltcMargin = ltcTargetExchange/parseFloat(ltcExchange.Bid);
  ltcMarginBack = ltcTargetExchangeBack/parseFloat(ltcExchange.Ask);
  var ltcTrade = shouldTrade(ltcMargin, ltcMarginBack, 'LTC');
  ltcProfit = ((ltcMargin - 1) * 100).toFixed(5);
  ltcProfitBack = ((ltcMarginBack - 1) * 100).toFixed(5);

  var newTradeFlag = findTradeFlag();
  if (trade_flag != newTradeFlag) {
    if (cancelAllTimeout[0] == newTradeFlag) {
      clearTimeout(cancelAllTimeout[1]);
      cancelAllTimeout[0] = -1;
      cancelAllTimeout[1] = 0;
    }
    cancelAllTimeout[0] = trade_flag;
    trade_flag = newTradeFlag;
    cancelAllTimeout[1] = setTimeout(() => {
      cancelOutstandingOrders(function() {
        trade_flag = findTradeFlag();
        startTrades(trade_flag);
      });}, 1010);
  }

  cb({
    layout: !req.xhr,
    title: "GDAX Monitor", 
    currentDate: formatDate(new Date()),
    btcAsk: parseFloat(btc.Ask).toFixed(2), 
    btcBid: parseFloat(btcBid).toFixed(2), 
    ethAsk: parseFloat(eth.Ask).toFixed(2), 
    ethBid: parseFloat(ethBid).toFixed(2), 
    exchangeAsk: parseFloat(exchange.Ask).toFixed(5), 
    exchangeBid: parseFloat(exchange.Bid).toFixed(5), 
    target: targetExchange, 
    targetBack: targetExchangeBack,
    margin: margin, 
    marginBack: marginBack,
    profit: profit, 
    profitBack: profitBack,
    trade: trade, 
    ltcBid: parseFloat(ltcBid).toFixed(2), 
    ltcAsk: parseFloat(ltc.Ask).toFixed(2), 
    ltcExchangeAsk: parseFloat(ltcExchange.Ask).toFixed(5), 
    ltcExchangeBid: parseFloat(ltcExchange.Bid).toFixed(5), 
    ltcTarget: ltcTargetExchange, 
    ltcTargetBack: ltcTargetExchangeBack,
    ltcMargin: ltcMargin, 
    ltcMarginBack: ltcMarginBack,
    ltcProfit: ltcProfit, 
    ltcProfitBack: ltcProfitBack,
    ltcTrade: ltcTrade,
    usdBalance: usdBalance.toFixed(2),
    btcBalance: btcBalance.toFixed(5),
    btcValue: (btcBalance * parseFloat(btc.Ask)).toFixed(2),
    ethBalance: ethBalance.toFixed(5),
    ethValue: (ethBalance * parseFloat(eth.Ask)).toFixed(2),
    ltcBalance: ltcBalance.toFixed(5),
    ltcValue: (ltcBalance * parseFloat(ltc.Ask)).toFixed(2),
    totalValue: (usdBalance + 
      (btcBalance * parseFloat(btc.Ask)) + 
      (ethBalance * parseFloat(eth.Ask)) +
      (ltcBalance * parseFloat(ltc.Ask))).toFixed(2),
    balanceLog: balanceLog,
  })
}

function formatDate(date) {
  var ret = date.toString().slice(16);
  var cut = ret.slice(8, 17);
  return ret.replace(cut, '');
}

function findTradeFlag() {
  buffer_flag = trade_flag == 0 ? trade_flag : 1;
  if (margin - 1 > (BTC_TO_ETH_MARGIN - (buffer_flag * .0005))) {
    return BTC_ETH;
  } else if (marginBack - 1 < (ETH_TO_BTC_MARGIN + (buffer_flag * .0005))) {
    return ETH_BTC;
  } else {
    return NO_TRADE;
  }
}

function shouldTrade(margin, marginBack, coin) {
  if (margin - 1 > .01) {
    return "BUY BTC->" + coin + "!!";
  } else if (marginBack - 1 < -.01) {
    return "BUY " + coin + "->BTC!!";
  } else if (margin - 1 > (BTC_TO_ETH_MARGIN - (buffer_flag * .0005))) {
    return "Buy BTC->" + coin + "";
  } else if (marginBack - 1 < (ETH_TO_BTC_MARGIN + (buffer_flag * .0005))) {
    return "Buy " + coin + "->BTC";
  } else {
    return "False";
  }
}

function log(msg) {
  console.log(msg);
}

function logBig(msg) {
  console.log("\n\n");
  console.log(msg);
  console.log("\n\n");
}

module.exports = router;

