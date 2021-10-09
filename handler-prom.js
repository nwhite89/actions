const Web3 = require('web3'),
    fetch = require('node-fetch'),
    fs = require('fs'),
    stakedWallets = require('./json/staked.json').wallets;

module.exports.snapshot = async function () {
    return new Promise((resolve, reject) => {
        const spnd_contract = '0x75e3CF3DC6748ff6c92FE77646bE7d2fdFdFA623',
            bmbo_contract = '0x4510e3ac69574f3dfdb43139e97773b542c386e1',
            api_key = process.env.BSC_SCAN_API,
            url = 'https://api.bscscan.com/api',
            web3 = new Web3('https://bsc-dataseed.binance.org'),
            safepanda_abi = JSON.parse(fs.readFileSync('./json/abi/bep20-abi.json')),
            bamboo_abi = JSON.parse(fs.readFileSync('./json/abi/bamboo-abi.json')),
            bamboo = new web3.eth.Contract(bamboo_abi, bmbo_contract);

        let totalWalletsStaked = 0;
        let stakedWalletAddrs = [];
        let errWalletAdds = [];

        function getStoredSnapshot () {
            return new Promise(function (resolve, reject) {
                fetch('https://nebulae42.com/all-snapshot.php', { method: 'GET' }).then(function (result) {
                    result.json().then(function (json) {
                        resolve(json);
                    });
                })
            });
        }

        function getSnapshotPage (page) {
            return new Promise(function (snapPageResolve, snapPageReject) {
                const params = new URLSearchParams();

                params.append('module', 'token');
                params.append('action', 'tokenholderlist');
                params.append('contractaddress', spnd_contract);
                params.append('page', page);
                params.append('apikey', api_key);

                if (page === 2) {
                    params.append('offset', '10000');
                }

                fetch(url, { method: 'POST', body: params }).then(function (result) {
                    result.json().then(function (json) {
                        const totalPromises = [];

                        for (let index = 0; index < json.result.length; index++) {
                            totalPromises.push(getStakedSPND(json.result[index]))
                        }

                        Promise.all(totalPromises).then(function (totals) {
                            snapPageResolve(totals);
                        }).catch(function (err) {
                            console.log(err);
                        });
                    });
                });
            });
        }

        function getStakedSPND (wallet) {
            return new Promise(function (stakedResolve, stakedReject) {
                if (!stakedWallets.includes(wallet.TokenHolderAddress)) {
                    stakedResolve({
                        address: wallet.TokenHolderAddress,
                        total: wallet.TokenHolderQuantity
                    })
                    return;
                }

                bamboo.methods._addressStakedSafePanda(wallet.TokenHolderAddress).call().then(function (result) {
                    const held = new web3.utils.BN(wallet.TokenHolderQuantity),
                        staked = new web3.utils.BN(result);

                    if (staked.toString() !== '0') {
                        stakedWalletAddrs.push(wallet.TokenHolderAddress);
                        totalWalletsStaked = totalWalletsStaked + 1;
                    }

                    stakedResolve({
                        address: wallet.TokenHolderAddress,
                        total: held.add(staked).toString()
                    })
                }).catch(function (err) {
                    errWalletAdds.push(wallet.TokenHolderAddress);
                    stakedResolve({
                        address: wallet.TokenHolderAddress,
                        total: wallet.TokenHolderQuantity,
                        err: true,
                    });
                });
            });
        }

        function held(_old, _held) {
            const old = new web3.utils.BN(_old),
                held = new web3.utils.BN(_held);

            return web3.utils.BN.min(old, held).toString();
        }

        Promise.all([getStoredSnapshot(), getSnapshotPage(1), getSnapshotPage(2)]).then(function ([pastSnapshot, first, second]) {
            const wallets = {};
            const results = [...first, ...second];
            const errWallets = [];
            let change = false;

            console.log('Total amount of wallets still staked:', totalWalletsStaked);

            results.forEach(element => {
                // First snapshot woop.
                if (!pastSnapshot.results || !pastSnapshot.length) {
                    wallets[element.address] = element.total;
                    return;
                }

                // New wallet say NO
                if (!pastSnapshot.results[element.address]) {
                    return;
                }

                if (element.err) {
                    errWallets.push(element.address);
                    // There was an error in this go around therefore use old amount will be picked up.
                    wallets[element.address] = pastSnapshot.results[element.address];
                    return;
                }

                let calc = held(pastSnapshot.results[element.address], element.total);

                // Wallet changed amount
                if (pastSnapshot.results[element.address] !== calc) {
                    change = true;
                }

                // Get held
                wallets[element.address] = calc;
            });

            // console.log('Error Wallets to be picked up next go', errWallets);

            var body = {
                'ssh': process.env.SSH,
                values: Object.keys(wallets).map(addr => {
                    return {addr: addr, amount: wallets[addr]};
                })
            };

            fetch('https://nebulae42.com/hidden-update.php?a=' + new Date().getTime(), {
                method: 'POST',
                body: JSON.stringify(body),
                headers: { 'Content-Type': 'application/json' }
            }).then(function (res) {
                resolve();
            }).catch((e) => {
                console.log(e);
                reject();
            })
        });
    })
}
