/* global jsRoutes */

'use strict';

var React = require('react');
var DropdownButton = require('react-bootstrap').DropdownButton;
var MenuItem = require('react-bootstrap').MenuItem;

var UserMenu = React.createClass({
    getInitialState() {
        return ({
        });
    },
    componentWillMount() {
    },
    render() {
        return (
            <DropdownButton navItem title={this.props.fullName}>
                <MenuItem href={jsRoutes.controllers.UsersController.editUserForm(this.props.loginName).url}>Edit profile</MenuItem>
                <MenuItem divider />
                <MenuItem href={jsRoutes.controllers.SessionsController.destroy().url}><i className="fa fa-sign-out"></i> Log out</MenuItem>
            </DropdownButton>
        );
    }
});

module.exports = UserMenu;
