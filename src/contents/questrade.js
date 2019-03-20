(function () {

    var parseValue = text => text && parseFloat(text.replace(/,/g, ''));
    var viewport= null;

    // Need at least symbol and market value. User will need to edit columns to add currency.
    var positions = $('table')
        .has('th[data-qt="lblPositionsSymbol"]')
        .has('th[data-qt="lblPositionsMarketValue"]')
        .find('tbody tr')
        .map((index, element) => ({
            symbol: $(element).find('[data-qt="boxPositionsSymbol"]').find('[data-qt="lstPositionsSymbol"]').text().toUpperCase(),
            value: parseValue($(element).find('[data-qt="lstPositionsMarketValue"]').text()),
            currency: $(element).find('[data-qt="lstPositionsCurrency"]').text().toUpperCase()
        }))
        .toArray();

    // If table with positions couldn't be found, user may be in mobile view, so look for positions there.
    // Unfortunately currency doesn't display in mobile view.
    if (positions.length) {
        viewport = 'wide';
    } else {
        positions = $('ul')
            .has('[data-qt="lblSymbolName"]')
            .has('[data-qt="lblCurrentValue"]')
            .find('li')
            .map((index, element) => ({
                symbol: $(element).find('[data-qt="lblSymbolName"]').text().toUpperCase(),
                value: parseValue($(element).find('[data-qt="lblCurrentValue"]').text())
            }))
            .toArray();

        if (positions.length)
            viewport = 'narrow';
    }

    var accountName = $('[data-qt="lblSelectorName"]').first().text();

    if (!accountName)
        return;

    var getInfo = function () {
        if (!positions.length)
            return 'Positions list is empty.';

        if (positions.some(p => !p.currency)) {
            if (viewport === 'narrow')
                return 'Switch to wide screen to find currency.'
            else
                return `Currency is missing. Edit columns and add 'Currency' to the list.`;
        }

        return null;;
    };

    chrome.runtime.sendMessage({
        brokerage: {
            account: {
                id: 'questrade:' + accountName,
                name: accountName,
                positions: positions
            },
            message: {
                error: null,
                info: getInfo()
            }
        }
    });

}());
