// The only place the product and brand names live. Rename here and everything follows:
// page titles, headers, report drafts, API meta and the README test that checks the header.
const PRODUCT_NAME = 'Proof of Progress';
const BRAND = 'Cernen';
// How the brand is shown in the UI header. Trademark sign only, never the registered sign.
const BRAND_DISPLAY = `${BRAND}${String.fromCharCode(0x2122)}`;

module.exports = { PRODUCT_NAME, BRAND, BRAND_DISPLAY };
