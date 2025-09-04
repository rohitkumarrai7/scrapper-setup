// JS to handle show/hide extension
setTimeout(() => {
    hideExtension();
}, 15);

function hideExtension() {
    if ($('.rcrm-ext-container').css('display') == 'none') {
        $('.rcrm-ext-container').css('display', 'block');
    }
    else {
        $('.rcrm-ext-container').css('display', 'none');
    }
}
