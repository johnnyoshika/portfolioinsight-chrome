let PINSIGHT = window.PINSIGHT || {};

PINSIGHT.console = (function () {

    // Disable automatic style injection to not violate CSP
    Chart.platform.disableCSSInjection = true;

    //#region HELPERS

    let parseValue = text => text && parseFloat(text.replace(/[,$]/g, ''));

    // https://stackoverflow.com/a/2901298/188740
    let formatValue = function (x) {
        let round2Decimals = x => Math.round(x * 100) / 100;
        let parts = round2Decimals(x).toString().split(".");
        parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
        return parts.join(".");
    };

    
    let formatDate = date => date.toISOString().split('T')[0];

    //#endregion

    //#region Mediator

    let Mediator = Backbone.Model.extend({
        initialize: function (attributes, options) {
            this.set('accounts', new Accounts([]));
            this.set('currencies', new Currencies([]));
            this.set('allocations', new Allocations([]));
            this.listenTo(this.get('accounts'), 'add remove update reset', this._onAccountsChange);

            chrome.storage.sync.get(['accounts', 'currencies', 'allocations'], data => this._setValues(data));

            chrome.storage.onChanged.addListener((changes, namespace) => this._onStorageChanged(changes));

            if (attributes.type === 'popup')
            {
                chrome.runtime.onMessage.addListener(request =>
                    request.brokerage
                        && this.set('brokerage', new Brokerage(request.brokerage)));

                chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
                    let tab = tabs[0];
                    if (/https:\/\/www\.scotiaonline\.scotiabank\.com\/online\/views\/accounts\/accountDetails\/.+/.test(tab.url))
                        this._executeScript('/contents/scotia-itrade.js');
                    else if (/https:\/\/my(practice)*?\.questrade\.com\/trading\/account\/balances/.test(tab.url))
                        this._executeScript('/contents/questrade-balances.js');
                    else if (/https:\/\/my(practice)*?\.questrade\.com\/trading\/account\/positions/.test(tab.url))
                        this._executeScript('/contents/questrade-positions.js');
                    else if (/https:\/\/my\.wealthsimple\.com\/app\/account/.test(tab.url))
                        this._executeScript('/contents/wealthsimple.js');
                });
            }
        },

        _executeScript: function(file) {
            chrome.tabs.executeScript(null, { file: '/libs/jquery-3.3.1.min.js' }, function () {
                chrome.tabs.executeScript(null, { file: file });
            });
        },

        _setValues: function (data) {
            ['accounts', 'currencies', 'allocations'].forEach(n => {
                if (data[n])
                    this['_set' + this._capitalize(n)](data[n]);
            });
            this.trigger('calculate');
        },

        _onStorageChanged: function (changes) {
            ['accounts', 'currencies', 'allocations'].forEach(n => {
                if (changes[n])
                    this['_set' + this._capitalize(n)](changes[n].newValue)
            });
            this.trigger('calculate');
        },

        _capitalize: function (text) {
            return text.charAt(0).toUpperCase() + text.slice(1);
        },

        _storeCollection: function(collection, collectionName) {
            let obj = {};
            obj[collectionName] = this['_defined' + this._capitalize(collectionName)](collection);
            chrome.storage.sync.set(obj);
        },

        _addModelInCollection: function (model, collectionName, at) {
            let collection = this.get(collectionName);
            collection.add(model, { merge: true, at: at });
            this._storeCollection(collection, collectionName);
        },

        _updateModelInCollection: function(model, collectionName, changes) {
            model.set(changes);
            let collection = this.get(collectionName);
            collection.add(model, { merge: true });
            this._storeCollection(collection, collectionName);
        },

        _removeModelInCollection: function(model, collectionName) {
            let collection = this.get(collectionName);
            collection.remove(model);
            this._storeCollection(collection, collectionName);
        },

        _definedAccounts: function (accounts) {
            return accounts.toJSON();
        },

        _setAccounts: function (accounts) {
            this.get('accounts').set(accounts);
        },

        addAccount: function (account) {
            this._addModelInCollection(account, 'accounts', 0);
        },

        updateAccount: function (account, changes) {
            this._updateModelInCollection(account, 'accounts', changes);
        },

        removeAccount: function (account) {
            this._removeModelInCollection(account, 'accounts');
        },

        _definedCurrencies: function (currencies) {
            return currencies
                .toJSON()
                .filter(c => _.isNumber(c.multiplier));
        },

        _setCurrencies: function (currencies) {
            this.get('currencies').set(
                currencies.concat(
                    this._missingCurrencyCodes(currencies).map(code =>
                        new Currency({
                            id: code,
                            code: code
                        }))));
        },

        addCurrency: function (currency) {
            this._addModelInCollection(currency, 'currencies');
        },

        updateCurrency: function (currency, changes) {
            this._updateModelInCollection(currency, 'currencies', changes);
        },

        removeCurrency: function (currency) {
            this._removeModelInCollection(currency, 'currencies');
        },

        _definedAllocations: function (allocations) {
            return allocations
                .toJSON()
                .filter(a => !!a.assetClasses.length);
        },

        _setAllocations: function (allocations) {
            this.get('allocations').set(
                allocations.concat(
                    this._missingAllocationTickers(allocations).map(ticker =>
                        new Allocation({
                            id: ticker,
                            ticker: ticker
                        }))));
        },

        addAllocation: function (allocation) {
            this._addModelInCollection(allocation, 'allocations');
        },

        updateAllocation: function (allocation, changes) {
            this._updateModelInCollection(allocation, 'allocations', changes);
        },

        removeAllocation: function (allocation) {
            this._removeModelInCollection(allocation, 'allocations');
        },

        _onAccountsChange: function() {
            this._setCurrencies(this._definedCurrencies(this.get('currencies')));
            this._setAllocations(this._definedAllocations(this.get('allocations')));
        },

        _portfolioCurrencyCodes: function() {
            return _.uniq(this.get('accounts')
                .toJSON()
                .flatMap(a => a.positions)
                .map(p => p.currency)
                .filter(c => !!c));
        },

        _portfolioTickers: function () {
            return _.uniq(this.get('accounts')
                .toJSON()
                .flatMap(a => a.positions)
                .map(p => p.ticker));
        },

        _missingCurrencyCodes: function(currencies) {
            let defined = currencies.map(c => c.code);
            return this._portfolioCurrencyCodes()
                .filter(c => !defined.some(d => d == c));
        },

        _missingAllocationTickers: function (allocations) {
            let allotted = allocations.map(a => a.ticker);
            return this._portfolioTickers()
                .filter(t => !allotted.some(a => a == t));
        },

        goToDashboard: function () {
            chrome.tabs.create({ url: chrome.runtime.getURL('pages/dashboard.html') });
        }
    });

    //#endregion

    //#region Brokerage

    let Message = Backbone.Model.extend({
    });

    let Brokerage = Backbone.Model.extend({

        defaults: {
            includeCash: true
        },

        initialize: function (attributes) {
            this.set('account', new Account(attributes.account));
            this.set('message', new Message(attributes.message));
        }
    });

    //#endregion

    //#region Account

    let Account = Backbone.Model.extend({
        defaults: {
            hidden: false,
            type: null // cash-only, excludes-cash
        }
    });

    let Accounts = Backbone.Collection.extend({
        model: Account
    });

    //#endregion

    //#region Currency

    let Currency = Backbone.Model.extend({
    });

    let Currencies = Backbone.Collection.extend({
        model: Currency
    });

    //#endregion

    //#region Allocation

    let Allocation = Backbone.Model.extend({
        defaults: {
            assetClasses: []
        },

        isMultiAsset: function() {
            return this.get('assetClasses').length > 1;
        },

        getDescription: function() {
            if (!this.isMultiAsset())
                return this.get('assetClasses').reduce((a, c) => a + c.name, '');

            return this.get('assetClasses').map(c => `${c.name}:${c.percentage * 100}`).join(',');
        },

        parseDescription: function (description) {
            let keyValues = description.split(',');
            if (keyValues.length === 1)
                return [{
                    name: description.split(':')[0].trim(), // TODO: empty validation
                    percentage: 1
                }];

            let classes = keyValues.map(kv => {
                let pair = kv.split(':');

                let percentage = null;
                if (pair.length > 1) {
                    let match = pair[1].match(/[\d\.]{1,}/);
                    if (match) {
                        let value = parseFloat(match[0]);
                        if (value > 100)
                            throw Error(`'${pair[0]}' exceeds 100%`);

                        percentage = Math.round(value * 10) / 1000;
                    }
                }

                return {
                    name: pair[0].trim(), // TODO: empty validation
                    percentage: percentage
                };
            }).filter(c => c.percentage !== 0);

            let sum = (assetClasses) => assetClasses.filter(c => c.percentage).reduce((acc, current) => acc + current.percentage, 0);

            if (sum(classes) > 1)
                throw Error('Exceeds 100%');

            let missing = classes.filter(c => !c.percentage);
            missing.forEach((m, i) => {
                let remaining = 1 - sum(classes);
                m.percentage = Math.round(remaining / (missing.length - i) * 1000) / 1000;
            });

            if (sum(classes) != 1)
                throw Error('Does not add up to 100%');

            return classes;
        }
    });

    let Allocations = Backbone.Collection.extend({
        model: Allocation
    });

    //#endregion

    //#region Assets

    let Assets = Backbone.Model.extend({
        defaults: {
            assets: {
                items: [],
                total: 0
            }
        },

        initialize: function (attributes, options) {
            this.mediator = options.mediator;
            this.listenTo(options.mediator, 'calculate', this.calculate);
            this.calculate();
        },

        convertValue: function (value, currencyCode, currencies) {
            let currency = currencies.find(c => c.code.toUpperCase() === (currencyCode || '').toUpperCase() && _.isNumber(c.multiplier)) || { multiplier: 1 };
            return value * currency.multiplier;
        },

        calculate: function () {
            let currencies = this.mediator.get('currencies').toJSON();
            let allocations = this.mediator.get('allocations').toJSON();
            let accounts = this.mediator.get('accounts').toJSON();
            let positions = accounts.flatMap(account => account.positions);

            let assets = positions
                .map(p => ({
                    position: p,
                    allocation: allocations.find(a => a.ticker === p.ticker && !!a.assetClasses.length)
                        ||
                        {
                            ticker: p.ticker,
                            assetClasses: [{
                                name: '???',
                                percentage: 1
                            }]
                        }
                }))
                .reduce((assets, pm) =>
                    pm.allocation.assetClasses.reduce((assets, assetClass) => {
                        let asset = assets.find(a => a.assetClass === assetClass.name);
                        if (!asset) {
                            asset = { assetClass: assetClass.name, value: 0 };
                            assets.push(asset);
                        }
                        asset.value += this.convertValue(pm.position.value * assetClass.percentage, pm.position.currency, currencies);
                        return assets;
                    }, assets), []);

            let total = assets.reduce((sum, a) => sum + a.value, 0);
            assets = assets
                .sort((a, b) => b.value - a.value)
                .map(a => ({ assetClass: a.assetClass, value: a.value, percentage: a.value / total }));

            this.set('assets', {
                items: assets,
                total: total
            });
        },

        getPortfolioCsv: function () {
            return Papa.unparse({
                fields: ['Brokerage', 'Account ID', 'Account Name', 'Ticker', 'Value', 'Currency', 'Currency Multiplier', 'Normalized Value', 'Asset Class'],
                data: this.mediator.get('accounts')
                        .toJSON()
                        .flatMap(a =>
                            a.positions.flatMap(p => {
                                let currency = this.mediator.get('currencies').toJSON().find(c => c.code === p.currency);
                                let allocation = this.mediator.get('allocations').toJSON().find(a => a.ticker === p.ticker);
                                if (allocation == null || !allocation.assetClasses.length)
                                    allocation = { assetClasses: [{ percentage: 1 }] };

                                return allocation.assetClasses.map(ac => {
                                    let value = p.value * ac.percentage;
                                    return [
                                        a.brokerage,
                                        a.id,
                                        a.name,
                                        p.ticker,
                                        value,
                                        p.currency,
                                        currency && currency.multiplier,
                                        value * ((currency && currency.multiplier) || 1),
                                        ac.name
                                    ];
                                });
                            })
                        )
            });
        },

        getAssetsCsv: function () {
            return Papa.unparse({
                fields: ['Asset Class', 'Value', '% Portfolio'],
                data: this.get('assets')
                    .items
                    .map(i =>[i.assetClass, i.value, i.percentage])
            });
        }
    });

    //#endregion

    //#region BaseView

    let BaseView = function (options) {
        this.parent = null;
        this.children = [];
        this.options = options; // as of Backbone 1.1.0, options are no longer automatically attached: https://github.com/jashkenas/backbone/commit/a22cbc7f36f0f7bd2b1d6f62e353e95deb4eda3a
        Backbone.View.apply(this, [options]);
    };

    _.extend(BaseView.prototype, Backbone.View.prototype, {
        addChildren: function (arg) {
            let children, that = this;

            if (_.isArray(arg)) {
                children = arg;
            } else {
                children = _.toArray(arguments);
            }

            _.each(children, function (child) {
                that.children.push(child);
                child.parent = that;
            });

            if (children.length === 1)
                return children[0];
            else
                return children;
        },

        disposeChildren: function (arg) {
            if (!arg)
                return;

            let children = _.isArray(arg) ? arg : _.toArray(arguments);

            _.each(children, function (child) {
                child.dispose();
            });
        },

        disposeAllChildren: function () {
            // clone first because child is going to reach up into parent (this) and call _removeChild()
            let clonedChildren = this.children.slice(0);
            _.each(clonedChildren, function (child) {
                child.dispose();
            });
        },

        dispose: function () {
            this.disposeAllChildren();
            this.remove();
            this._removeFromParent();
        },

        _removeFromParent: function () {
            if (this.parent) this.parent._removeChild(this);
        },

        _removeChild: function (child) {
            let index = _.indexOf(this.children, child);
            if (index !== -1)
                this.children.splice(index, 1);
        }
    });

    BaseView.extend = Backbone.View.extend;

    //#endregion

    //#region PopupView

    let PopupView = BaseView.extend({
        template: Handlebars.templates.popup,

        events: {
            'click [data-action="go-dashboard"]': 'onGoDashboardClick'
        },

        onGoDashboardClick: function () {
            this.model.goToDashboard();
        },

        render: function () {
            this.$el.html(this.template());

            this.$('[data-outlet="brokerage"]').append(
              this.addChildren(
                new BrokerageView({
                    model: this.model
                })
              )
              .render().el
            );

            this.$('[data-outlet="accounts"]').append(
              this.addChildren(
                new AccountsView({
                    collection: this.model.get('accounts'),
                    mediator: this.model
                })
              )
              .render().el
            );

            return this;
        }
    });

    //#endregion

    //#region BrokerageView

    let BrokerageView = BaseView.extend({
        template: Handlebars.templates.brokerage,

        initialize: function () {
            this.listenTo(this.model, 'change:brokerage', this.render);
            this.listenTo(this.model.get('accounts'), 'add remove reset', this.render);
        },

        events: {
            'click [data-action="add"]': 'onAddClick',
            'input [name="includeCash"]': 'onIncludeCashInput'
        },

        onAddClick: function (e) {
            let brokerage = this.model.get('brokerage');
            let account = this.model.get('accounts').get(brokerage.get('account').id);
            if (account)
                this.model.updateAccount(account, this.replacementJSON(account, brokerage.get('account')));
            else
                this.model.addAccount(new Account(this.addJSON(brokerage.get('account'))));
        },

        onIncludeCashInput: function(e) {
            this.model.get('brokerage').set('includeCash', $(e.currentTarget).prop('checked'));
            this.render();
        },

        addJSON: function(brokerageAccount) {
            var json = brokerageAccount.toJSON();
            json.positions = json.positions
                .filter(p => p.ticker !== 'CASH' || this.model.get('brokerage').get('includeCash'));
            return json;
        },

        replacementJSON: function (account, brokerageAccount) {
            var json = brokerageAccount.toJSON();
            json.positions = this.replacementPositions(account.get('positions'), brokerageAccount.get('positions'), brokerageAccount.get('type'))
                .filter(p => p.ticker !== 'CASH' || this.model.get('brokerage').get('includeCash'));
            return json;
        },

        replacementPositions: function(accountPositions, brokeragePositions, type) {
            switch (type) {
                case 'cash-only':
                    return accountPositions.filter(p => p.ticker !== 'CASH').concat(brokeragePositions);
                case 'excludes-cash':
                    return accountPositions.filter(p => p.ticker === 'CASH').concat(brokeragePositions);
                default:
                    return brokeragePositions;
            }
        },

        render: function () {
            this.disposeAllChildren();

            let brokerage = this.model.get('brokerage');
            this.$el.html(this.template({
                info: brokerage && brokerage.get('message').get('info'),
                error: brokerage && brokerage.get('message').get('error'),
                found: !!brokerage,
                hasCash: !!brokerage && brokerage.get('account').get('positions').some(p => p.ticker === 'CASH'),
                includeCash: brokerage && brokerage.get('includeCash'),
                exists: !!this.model.get('accounts').get(brokerage && brokerage.get('account') && brokerage.get('account').id)
            }));

            if (brokerage)
                this.$('[data-outlet="account"]').append(
                    this.addChildren(
                        new AccountView({
                            model: brokerage.get('account'),
                            hideCash: !brokerage.get('includeCash')
                        })
                    )
                    .render().el
                );

            return this;
        }
    });

    //#endregion

    //#region DashboardView

    let DashboardView = BaseView.extend({
        template: Handlebars.templates.dashboard,

        render: function () {
            this.$el.html(this.template());

            this.$('[data-outlet="accounts"]').append(
              this.addChildren(
                new AccountsView({
                    collection: this.model.get('accounts'),
                    mediator: this.model
                })
              )
              .render().el
            );

            this.$('[data-outlet="currencies"]').append(
              this.addChildren(
                new CurrenciesView({
                    collection: this.model.get('currencies'),
                    mediator: this.model
                })
              )
              .render().el
            );

            this.$('[data-outlet="allocations"]').append(
              this.addChildren(
                new AllocationsView({
                    collection: this.model.get('allocations'),
                    mediator: this.model
                })
              )
              .render().el
            );

            let assets = new Assets(null, { mediator: this.model });
            this.$('[data-outlet="assets"]').append(
              this.addChildren(
                new AssetsView({
                    model: assets
                })
              )
              .render().el
            );

            this.$('[data-outlet="download"]').append(
              this.addChildren(
                new DownloadView({
                    model: assets
                })
              )
              .render().el
            );

            return this;
        }
    });

    //#endregion

    //#region AccountsView

    let AccountsView = BaseView.extend({
        template: Handlebars.templates.accounts,

        initialize: function() {
            this.listenTo(this.collection, 'add remove reset sort', this.render);
            this.listenTo(this.collection, 'update', this.onUpdate);
        },

        onUpdate: function (collection, changes) {
            // This is complicated. If the change was just the 'hidden' property, we don't want to re-render b/c we want to let AccountView
            // animate showing/hiding. If however, brokerage name or positions changed, then we want to re-render.
            // If just hidden changed, all of the collection.models.changed objects would all be {}.
            // If anything else changed (e.g. positions), then one of the collection.models.changed objects will be populated {positions:[...], hidden: false}
            // so all we need to do is check for a presence in models.changed and if there's something there, render
            if (collection.models.some(m => Object.keys(m.changed).length))
                this.render();
        },

        render: function () {
            this.disposeAllChildren();
            this.$el.html(this.template());

            if (this.collection.length) {
                this.$('[data-outlet="account"]').empty();
                this.collection.each(account => {
                    this.$('[data-outlet="account"]').append(
                        this.addChildren(
                            new AccountView({
                                model: account,
                                actionable: true,
                                mediator: this.options.mediator
                            })
                        )
                        .render().el
                    );
                });
            }

            return this;
        }
    });

    //#endregion

    //#region AccountView

    let AccountView = BaseView.extend({
        template: Handlebars.templates.account,

        initialize: function (options) {
            options.hideCash = options.hideCash || false;
            this.listenTo(this.model, 'change', this.onModelChange);
        },

        events: {
            'click [data-action="remove"]': 'onRemoveClick',
            'click [data-action="toggle"]': 'onToggleClick'
        },

        onRemoveClick: function (e) {
            e.preventDefault();
            this.options.mediator.removeAccount(this.model);
        },

        onToggleClick: function (e) {
            e.preventDefault();
            this.options.mediator.updateAccount(this.model, { hidden: !this.model.get('hidden') });
        },

        onModelChange: function (model) {
            let keys = Object.keys(model.changed);
            if (keys.length === 1 && keys.includes('hidden'))
            {
                if (this.model.get('hidden'))
                    this.$('[data-element="positions"]').slideUp();
                else
                    this.$('[data-element="positions"]').slideDown();
                this.toggleChevron();
            } else {
                this.render();
            }
        },

        toggleChevron: function () {
            if (this.model.get('hidden'))
                this.$('.fa-chevron-down')
                    .removeClass('fa-chevron-down')
                    .addClass('fa-chevron-up');
            else
                this.$('.fa-chevron-up')
                    .removeClass('fa-chevron-up')
                    .addClass('fa-chevron-down');
        },

        toggle: function () {
            this.$('[data-element="positions"]').toggle(!this.model.get('hidden'));
            this.toggleChevron();
        },

        render: function () {
            let json = this.model.toJSON();
            json.positions = json.positions.map(p => ({
                ticker: p.ticker,
                value: formatValue(p.value),
                currency: p.currency
            })).filter(p => p.ticker !== 'CASH' || !this.options.hideCash);
            this.$el.html(this.template({
                actionable: this.options.actionable,
                account: json
            }));
            this.toggle();
            return this;
        }
    });

    //#endregion

    //#region ItemView

    let ItemView = BaseView.extend({
        tagName: 'tr',

        initialize: function () {
            this.state = 'idle';
            this.listenTo(this.model, 'change', this.render);
        },

        events: {
            'click [data-action="edit"]': 'onEditClick',
            'submit [data-action="submit"]': 'onSubmit',
            'click [data-action="remove"]': 'onRemoveClick'
        },

        onEditClick: function (e) {
            e.preventDefault();
            this.renderForm();
        },

        onSubmit: function (e) {
            let isNew = this.isNew();
            e.preventDefault();
            this.editModel();
            if (isNew)
                this.options.parent.trigger('add-new');
            else
                this.render(); // just in case there's no change, we still want to trigger a render
        },

        onRemoveClick: function (e) {
            e.preventDefault();
            this.removeModel();
        },

        getViewModel: function() {
            return this.model.toJSON();
        },

        renderForm: function() {
            this.$el.html(this.templateForm(this.getViewModel()));
            this.$('input').first().focus();
        },

        renderDetails() {
            this.$el.html(this.template(this.getViewModel()));
        },

        render: function () {
            if (this.isNew())
                this.renderForm();
            else
                this.renderDetails();

            return this;
        }
    });

    //#endregion

    //#region CurrencyView

    let CurrencyView = ItemView.extend({
        template: Handlebars.templates.currency,
        templateForm: Handlebars.templates.currencyForm,

        editModel: function () {
            this.options.mediator.updateCurrency(this.model, {
                multiplier: parseValue(this.$('[name="multiplier"]').val())
            });
        },

        isNew: function() {
            return !_.isNumber(this.model.get('multiplier'));
        },

        removeModel: function (e) {
            this.options.mediator.removeCurrency(this.model);
        }
    });

    //#endregion

    //#region AllocationView

    let AllocationView = ItemView.extend({
        template: Handlebars.templates.allocation,
        templateForm: Handlebars.templates.allocationForm,

        events: function(){
            return _.extend({}, ItemView.prototype.events, {
                'input input' : 'onInput'
            });
        },

        onInput: function (e) {
            try {
                this.model.parseDescription($(e.currentTarget).val());
                e.currentTarget.setCustomValidity('')
            } catch (ex) {
                e.currentTarget.setCustomValidity(ex.message);
            }
        },

        editModel: function () {
            this.options.mediator.updateAllocation(this.model, {
                assetClasses: this.model.parseDescription(this.$('[name="description"]').val())
            });
        },

        isNew: function () {
            return !this.model.get('assetClasses').length;
        },

        removeModel: function (e) {
            this.options.mediator.removeAllocation(this.model);
        },

        getViewModel: function () {
            var json = this.model.toJSON();
            json.description = this.model.getDescription();
            json.isMultiAsset = this.model.isMultiAsset();
            json.assetClasses = json.assetClasses.length
                ? json.assetClasses.map(ac => ({
                    name: ac.name,
                    percentage: formatValue(ac.percentage * 100)
                }))
                : [{}];
            return json;
        }
    });

    //#endregion

    //#region ItemsView

    let ItemsView = BaseView.extend({
        initialize: function () {
            this.listenTo(this.collection, 'add remove reset sort', this.render);
            this.listenTo(this, 'add-new', this.onAddNew);
        },

        onAddNew: function() {
            this.$('input').first().focus();
        },

        render: function () {
            this.$el.html(this.template(this.collection.toJSON()));

            this.collection.forEach(model => {
                this.$('[data-outlet="list"]').append(
                    this.addChildren(
                        new this.modelView({
                            model: model,
                            mediator: this.options.mediator,
                            parent: this
                        })
                    )
                    .render().el
                );
            });

            return this;
        }
    });

    //#endregion

    //#region CurrenciesView

    let CurrenciesView = ItemsView.extend({
        template: Handlebars.templates.currencies,
        templateForm: Handlebars.templates.currencyForm,
        templateAddButton: Handlebars.templates.currenciesAddButton,

        modelView: CurrencyView,

        addModel: function (e) {
            this.options.mediator.addCurrency(new Currency({
                id: this.$('[name="code"]').val().toUpperCase(),
                code: this.$('[name="code"]').val().toUpperCase(),
                multiplier: parseValue(this.$('[name="multiplier"]').val())
            }));
        }
    });

    //#endregion

    //#region AllocationsView

    let AllocationsView = ItemsView.extend({
        template: Handlebars.templates.allocations,
        templateForm: Handlebars.templates.allocationForm,
        templateAddButton: Handlebars.templates.allocationsAddButton,

        modelView: AllocationView,

        events: {
            'click [data-action="hint"]': 'onHintClick'
        },

        onHintClick: function(e) {
            e.preventDefault();
            this.$('[data-element="hint"]').slideToggle();
        },

        addModel: function (e) {
            this.options.mediator.addAllocation(new Allocation({
                id: this.$('[name="ticker"]').val().toUpperCase(),
                ticker: this.$('[name="ticker"]').val().toUpperCase(),
                assetClasses: [{
                    name: this.$('[name="assetClass"]').val(),
                    percentage: 1
                }]
            }));
        }
    });

    //#endregion

    //#region AssetsView

    let AssetsView = BaseView.extend({
        template: Handlebars.templates.assets,

        initialize: function () {
            this.listenTo(this.model, 'change:assets', this.render);
        },
        
        resizeCanvas: function (e) {
            if (!this.model.get('assets').items.length)
                return;

            if (this.chart) {
                this.chart.destroy();
                this.chart = null;
                this.$('canvas').remove();
            }

            let width = this.$('[data-outlet="chart"]').width();
            this.$('[data-outlet="chart"]').html(`<div style="height:${width}px" />`);

            clearTimeout(this.timer);
            this.timer = setTimeout(this.renderChart.bind(this), 500);
        },

        renderChart: function () {
            let assets = this.model.get('assets');
            let width = this.$('[data-element="card-body"]').width();
            let canvas = this.$('[data-outlet="chart"]')
                .html(`<canvas width="${width}" height="${width}"></canvas>`)
                    .find('canvas');

            // palette.js:
            // - https://github.com/google/palette.js
            // - https://stackoverflow.com/a/39884692/188740
            // - https://jsfiddle.net/2y3o0nkx/
            this.chart = new Chart(canvas, {
                type: 'pie',
                data: {
                    labels: assets.items.map(i => i.assetClass),
                    datasets: [{
                        data: assets.items.map(i => Math.round(i.percentage * 1000) / 10),
                        backgroundColor: palette('tol-rainbow', assets.items.length).map(hex => '#' + hex)
                    }]
                }
            });
        },

        render: function () {
            this.resizeCanvasWithContext = this.resizeCanvas.bind(this);
            window.addEventListener('resize', this.resizeCanvasWithContext, false);

            let assets = this.model.get('assets');
            this.$el.html(this.template({
                total: formatValue(assets.total),
                items: assets.items.map(i => ({
                    assetClass: i.assetClass,
                    value: formatValue(i.value),
                    percentage: (i.percentage * 100).toFixed(1)
                }))
            }));

            this.resizeCanvas();

            return this;
        },

        dispose: function () {
            window.removeEventListener('resize', this.resizeCanvasWithContext, false);
            BaseView.prototype.dispose.apply(this);
        }
    });
    
    //#endregion

    //#region DownloadView

    let DownloadView = BaseView.extend({
        template: Handlebars.templates.download,

        events: {
            'click [data-action="download-portfolio"]': 'onDownloadPortfolioClick',
            'click [data-action="download-assets"]': 'onDownloadAssetsClick'
        },

        onDownloadPortfolioClick: function() {
            let blob = new Blob([this.model.getPortfolioCsv()], { type: 'text/csv;charset=utf-8;' });
            let url = URL.createObjectURL(blob);
            chrome.downloads.download({
                url: url,
                filename: `${formatDate(new Date())} portfolio.csv`,
                saveAs: true
            });
        },

        onDownloadAssetsClick: function () {
            let blob = new Blob([this.model.getAssetsCsv()], { type: 'text/csv;charset=utf-8;' });
            let url = URL.createObjectURL(blob);
            chrome.downloads.download({
                url: url,
                filename: `${formatDate(new Date())} assets.csv`,
                saveAs: true
            });
        },

        render: function () {
            this.$el.html(this.template());
            return this;
        }
    });

    //#endregion

    return {
        popup: function () {
            $('[data-outlet="popup"]').append(new PopupView({
                model: new Mediator({
                    type: 'popup'
                })
            }).render().el);
        },
        dashboard: function () {
            $('[data-outlet="dashboard"]').append(new DashboardView({
                model: new Mediator({
                    type: 'dashboard'
                })
            }).render().el);
        }
    };

}());