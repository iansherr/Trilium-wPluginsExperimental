class FixtureHelloWidget extends api.BasicWidget {
    get parentWidget() { return "center-pane"; }
    get position() { return 999; }

    doRender() {
        this.$widget = $("<div class='fixture-hello-widget' style='padding: 1em'>Community package fixture v1</div>");
        return this.$widget;
    }
}

module.exports = new FixtureHelloWidget();
