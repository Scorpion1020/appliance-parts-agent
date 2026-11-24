import re
import unicodedata
from dataclasses import dataclass

from app.catalog.models import CatalogItem


@dataclass(frozen=True)
class AttributeVocabulary:
    colors: dict[str, set[str]]
    sizes: dict[str, set[str]]
    brands: dict[str, set[str]]


DEFAULT_ATTRIBUTE_VOCABULARY = AttributeVocabulary(
    colors={
        "black": {"black"},
        "white": {"white"},
        "navy": {"navy"},
        "grey": {"grey", "gray"},
        "forest": {"forest"},
        "olive": {"olive"},
        "charcoal": {"charcoal"},
        "camel": {"camel"},
        "speckled": {"speckled"},
        "indigo": {"indigo"},
        "brown": {"brown", "espresso"},
        "sand": {"sand"},
        "oatmeal": {"oatmeal"},
        "blue": {"blue"},
        "rust": {"rust"},
        "tan": {"tan"},
        "tortoise": {"tortoise"},
        "ecru": {"ecru"},
        "green": {"green"},
        "pink": {"pink", "rose"},
        "cream": {"cream"},
    },
    sizes={
        "xs": {"xs", "extra small", "extra-small"},
        "s": {"s", "small"},
        "m": {"m", "medium"},
        "l": {"l", "large"},
        "xl": {"xl", "extra large", "extra-large"},
        "xxl": {"xxl", "2xl", "double extra large"},
        "one_size": {"one size", "one-size", "os"},
    },
    brands={
        "aurora": {"aurora"},
        "cafe_noir": {"cafe noir", "cafe", "noir"},
        "classic": {"classic"},
        "garden_co": {"garden & co", "garden co", "garden"},
        "heritage": {"heritage"},
    },
)


class AttributeClassifier:
    def __init__(self, vocabulary: AttributeVocabulary = DEFAULT_ATTRIBUTE_VOCABULARY) -> None:
        self.vocabulary = vocabulary

    def matches(self, product: CatalogItem, color: str | None = None, size: str | None = None, brand: str | None = None) -> bool:
        return (
            self.matches_value(product, self.vocabulary.colors, color)
            and self.matches_value(product, self.vocabulary.sizes, size)
            and self.matches_value(product, self.vocabulary.brands, brand)
        )

    def matches_value(self, product: CatalogItem, vocabulary: dict[str, set[str]], value: str | None) -> bool:
        if value is None:
            return True
        aliases = vocabulary[self.normalize_filter_value(vocabulary, value)]
        text = self._product_text(product)
        tokens = self._tokens(text)
        return any(alias in text or alias in tokens for alias in aliases)

    def normalize_color(self, value: str) -> str:
        return self.normalize_filter_value(self.vocabulary.colors, value)

    def normalize_size(self, value: str) -> str:
        return self.normalize_filter_value(self.vocabulary.sizes, value)

    def normalize_brand(self, value: str) -> str:
        return self.normalize_filter_value(self.vocabulary.brands, value)

    def normalize_filter_value(self, vocabulary: dict[str, set[str]], value: str) -> str:
        normalized = self._normalize_text(value).replace("-", " ").replace("_", " ")
        for canonical, aliases in vocabulary.items():
            normalized_canonical = canonical.casefold().replace("_", " ")
            if normalized == normalized_canonical or normalized in aliases:
                return canonical
        raise ValueError(value)

    def _product_text(self, product: CatalogItem) -> str:
        return " ".join(
            [
                product.name,
                product.category or "",
                product.description or "",
                " ".join(product.tags),
            ]
        ).casefold()
        return self._normalize_text(text)

    def _tokens(self, text: str) -> set[str]:
        return set(re.findall(r"\w+", text))

    def _normalize_text(self, value: str) -> str:
        normalized = unicodedata.normalize("NFKD", value.strip().casefold())
        return "".join(character for character in normalized if not unicodedata.combining(character))
