from app.catalog.attributes import AttributeClassifier
from app.catalog.models import CatalogItem


def test_attribute_classifier_matches_predefined_color_vocabulary() -> None:
    classifier = AttributeClassifier()
    product = CatalogItem(
        id="prod_test",
        type="product",
        name="Heavyweight Hoodie - Black",
        category="apparel",
        market_id="us",
        language="en",
        description="Warm hoodie.",
        tags=["apparel", "black"],
    )

    assert classifier.matches(product, color="black")
    assert not classifier.matches(product, color="white")


def test_attribute_classifier_normalizes_aliases() -> None:
    classifier = AttributeClassifier()

    assert classifier.normalize_color("gray") == "grey"
    assert classifier.normalize_size("extra-large") == "xl"
    assert classifier.normalize_brand("Garden & Co") == "garden_co"


def test_attribute_classifier_matches_normalized_brand_text() -> None:
    classifier = AttributeClassifier()
    product = CatalogItem(
        id="prod_test",
        type="product",
        name="Cafe Noir Hoodie",
        category="apparel",
        market_id="us",
        language="en",
        description="A hoodie from Cafe Noir.",
        tags=["apparel"],
    )

    assert classifier.matches(product, brand="cafe_noir")
