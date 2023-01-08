import { Selector } from 'testcafe';
import { faker } from '@faker-js/faker';

fixture('Access the demo site')
    .page ('https://www.saucedemo.com');

test('Login form automate', async t => {
    console.log("---Automate the demo site---");

    await t
    //Access and login the demo site
    .typeText(Selector('#user-name'),'performance_glitch_user')
    .typeText(Selector('#password'),'secret_sauce')
    .click(Selector('#login-button'))

    //Check the price of product, Sauce Labs Fleece Jacket is $49.99 
    .expect(Selector('#item_5_title_link').withText('Sauce Labs Backpack').exists).ok()
    .expect(Selector('.inventory_item_price').withText('$49.99').exists).ok()

    //Add two products into the cart
    .click(Selector('#add-to-cart-sauce-labs-backpack'))
    .click(Selector('#add-to-cart-sauce-labs-bike-light'))

    //Click cart icon in the top 
    .click(Selector('.shopping_cart_link'))
    .wait(3000)

    //Verify if the selected items are in the cart
    .expect(Selector('.inventory_item_name').withText('Sauce Labs Backpack').exists).ok()
    .expect(Selector('.inventory_item_name').withText('Sauce Labs Bike Light').exists).ok()
    
    //Click checkout button
    .click(Selector('#checkout'))
    .wait(3000)

    //Provide a random firstname, lastname and a zip code
    .typeText(Selector('#first-name'),faker.name.firstName())
    .typeText(Selector('#last-name'),faker.name.lastName())
    .typeText(Selector('#postal-code'),faker.address.zipCode())
    .wait(3000)

    //Click continue button
    .click(Selector('#continue'))

    //Click Finish
    .click(Selector('#finish'))
    .wait(3000)

    .expect(Selector('.complete-header').withText('THANK YOU FOR YOUR ORDER').exists).ok()
    .wait(5000)
});
