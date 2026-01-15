#include <stdio.h>
#include <stdlib.h>

typedef struct Person {
    int age;
    char name;
} person;

int main()
{
    int x = 10;
    printf("This is a number:%d \n",x);
    int *mal = (int *) malloc(35);

    mal[0] = 5;
    mal[1] = 8;

    int *mal2 = (int *) malloc(50);
    return 0;
}